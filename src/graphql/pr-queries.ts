import { logVerbose } from "../logger";

/**
 * Sponsor fetch mode controls how sponsor information is retrieved.
 * Using an enum-like type instead of boolean to allow future extensibility.
 *
 * - 'none': Do not fetch sponsor information
 * - 'graphql': Fetch via GraphQL API (requires non-GitHub App token, even without any permissions)
 * - 'html': (Experimental) Fetch by making HEAD requests to HTML sponsor pages
 * - 'auto': Automatically select the best method based on token type and output format
 *
 * Note: We use this approach instead of a simple boolean to accommodate potential
 * future methods of fetching sponsor information without breaking the API.
 */
export type SponsorFetchMode = "none" | "graphql" | "html" | "auto";

// Type for PR Author from GraphQL response
export interface GraphQLAuthor {
	login: string;
	__typename: string;
	url: string;
	avatarUrl: string;
	sponsorsListing?: { url: string };
}

// Type for PR Label from GraphQL response
export interface GraphQLLabel {
	name: string;
}

// Type for Closing Issue from GraphQL response
export interface GraphQLClosingIssue {
	number: number;
	title: string;
	state: string;
	url: string;
	closedAt?: string;
	author: GraphQLAuthor;
	labels: { nodes: GraphQLLabel[] };
	repository: {
		name: string;
		owner: {
			login: string;
		};
	};
}

// Type for Pull Request from GraphQL response (raw from API)
export interface GraphQLPullRequest {
	number: number;
	title: string;
	mergedAt: string;
	url: string;
	body?: string;
	baseRefName?: string;
	headRefName?: string;
	additions?: number;
	deletions?: number;
	labels: { nodes: GraphQLLabel[] };
	author: GraphQLAuthor;
	closingIssuesReferences?: { nodes: GraphQLClosingIssue[] };
}

// Normalized PullRequest type (for consumption by core.ts)
export interface PullRequest {
	number: number;
	title: string;
	mergedAt: string;
	url: string;
	body?: string;
	baseRefName?: string;
	headRefName?: string;
	additions?: number;
	deletions?: number;
	labels: { nodes: GraphQLLabel[] };
	author: {
		login: string;
		type: string; // Normalized from __typename
		url: string;
		avatarUrl: string;
		sponsorsListing?: { url: string };
	};
	closingIssuesReferences?: { nodes: GraphQLClosingIssue[] };
	[key: string]: unknown; // Index signature for MinimalPullRequest compatibility
}

export type SearchPRParams = {
	owner: string;
	repo: string;
	sinceDate?: string;
	untilDate?: string;
	baseBranch?: string;
	graphqlFn: (
		query: string,
		variables?: Record<string, unknown>,
	) => Promise<unknown>;
	withBody: boolean;
	withBaseRefName: boolean;
	withHeadRefName: boolean;
	withClosingIssues: boolean;
	sponsorFetchMode?: SponsorFetchMode;
	includeLabels?: string[];
	excludeLabels?: string[];
};

function buildSearchQuery(): string {
	return /* GraphQL */ `
    query SearchMergedPRs(
      $q: String!
      $withBody: Boolean!
      $withBase: Boolean!
      $withHead: Boolean!
      $withClosingIssues: Boolean!
      $withSponsor: Boolean!
      $after: String
    ) {
      search(query: $q, type: ISSUE, first: 100, after: $after) {
        pageInfo { hasNextPage endCursor }
        nodes {
          ... on PullRequest {
            number
            title
            mergedAt
            url
            additions
            deletions
            body @include(if: $withBody)
            baseRefName @include(if: $withBase)
            headRefName @include(if: $withHead)
            closingIssuesReferences(first: 10) @include(if: $withClosingIssues) {
              nodes {
                number
                title
                state
                url
                closedAt
                author {
                  login
                  __typename
                  url
                  avatarUrl
                  ... on User { sponsorsListing @include(if: $withSponsor) { url } }
                }
                labels(first: 100) { nodes { name } }
                repository {
                  name
                  owner {
                    login
                  }
                }
              }
            }
            labels(first: 100) { nodes { name } }
            author {
              login
              __typename
              url
              avatarUrl
              # Note: sponsorsListing is public data but GitHub blocks app tokens
              # (including GITHUB_TOKEN in Actions) from accessing it.
              # A user token (even without any permissions) can access this field.
              # Ref: https://github.com/orgs/community/discussions/44226
              ... on User { sponsorsListing @include(if: $withSponsor) { url } }
            }
          }
        }
      }
    }
  `;
}

const {
	paginate,
}: {
	paginate: (
		graphqlFn: (
			query: string,
			variables?: Record<string, unknown>,
		) => Promise<unknown>,
		query: string,
		variables: Record<string, unknown>,
		path: string[],
	) => Promise<{ search: { nodes: GraphQLPullRequest[] } }>;
} = require("release-drafter/lib/pagination");

export async function fetchMergedPRs(
	params: SearchPRParams,
): Promise<PullRequest[]> {
	const {
		owner,
		repo,
		sinceDate,
		untilDate,
		baseBranch,
		graphqlFn,
		withBody,
		withBaseRefName,
		withHeadRefName,
		withClosingIssues,
		sponsorFetchMode = "none",
		includeLabels = [],
		excludeLabels = [],
	} = params;

	const qParts = [`repo:${owner}/${repo}`, `is:pr`, `is:merged`];
	if (baseBranch) {
		qParts.push(`base:${baseBranch}`);
	}
	// Date range for merged time: prefer a single range qualifier to avoid
	// multiple merged: qualifiers behaving unexpectedly.
	// GitHub search doc: https://docs.github.com/en/search-github/getting-started-with-searching-on-github/understanding-the-search-syntax#query-for-dates
	// - Supports comparisons (>, >=, <, <=) and range form "from..to".
	// - Time information like THH:MM:SSZ is allowed (same as sinceDate handling).
	// - Open ranges supported via "*" (e.g., from..* or *..to).
	if (sinceDate || untilDate) {
		const lower = sinceDate ?? "*";
		const upper = untilDate ?? "*";
		qParts.push(`merged:${lower}..${upper}`);
	}
	// Apply label filtering at search-level when possible
	// Exclude labels: remove PRs that have any of these labels
	for (const l of excludeLabels) {
		const name = String(l).replaceAll('"', '\\"');
		qParts.push(`-label:"${name}"`);
	}
	// Include labels: PR must have at least one of them (OR semantics using , separeated labels.)
	// https://github.blog/changelog/2021-08-02-search-issues-by-label-using-logical-or/
	if (includeLabels.length > 0) {
		const q = "label:" + includeLabels.map((l) => `"${l}"`).join(",");
		qParts.push(q);
	}
	const q = qParts.join(" ");
	logVerbose(`[PR Query] ${q}`);

	const query = buildSearchQuery();
	const data = await paginate(
		graphqlFn,
		query,
		{
			q,
			withBody,
			withBase: withBaseRefName,
			withHead: withHeadRefName,
			withClosingIssues,
			withSponsor: sponsorFetchMode === "graphql",
			after: null,
		},
		["search"],
	);
	const nodes = Array.isArray(data?.search?.nodes) ? data.search.nodes : [];

	// Normalize the GraphQL response to the expected format
	return nodes.map(
		(node: GraphQLPullRequest): PullRequest => ({
			number: node.number,
			title: node.title,
			mergedAt: node.mergedAt,
			url: node.url,
			body: node.body,
			baseRefName: node.baseRefName,
			headRefName: node.headRefName,
			additions: node.additions,
			deletions: node.deletions,
			labels: node.labels || { nodes: [] },
			author: {
				login: node.author.login,
				type: node.author.__typename, // Normalize __typename to type
				url: node.author.url,
				avatarUrl: node.author.avatarUrl,
				sponsorsListing: node.author.sponsorsListing,
			},
			closingIssuesReferences: node.closingIssuesReferences,
		}),
	);
}
