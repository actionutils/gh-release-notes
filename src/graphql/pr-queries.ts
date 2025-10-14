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

// Type for Pull Request from GraphQL response (raw from API)
export interface GraphQLPullRequest {
	number: number;
	title: string;
	mergedAt: string;
	url: string;
	body?: string;
	baseRefName?: string;
	headRefName?: string;
	labels: { nodes: GraphQLLabel[] };
	author: GraphQLAuthor;
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
	labels: { nodes: GraphQLLabel[] }; // Keep nodes structure for categorize compatibility
	author: {
		login: string;
		type: string; // Normalized from __typename
		url: string;
		avatarUrl: string;
		sponsorsListing?: { url: string };
	};
	[key: string]: unknown; // Index signature for MinimalPullRequest compatibility
}

export type SearchPRParams = {
	owner: string;
	repo: string;
	sinceDate?: string;
	baseBranch?: string;
	graphqlFn: (
		query: string,
		variables?: Record<string, unknown>,
	) => Promise<unknown>;
	withBody: boolean;
	withBaseRefName: boolean;
	withHeadRefName: boolean;
	sponsorFetchMode?: SponsorFetchMode;
};

function buildSearchQuery(): string {
	return /* GraphQL */ `
    query SearchMergedPRs(
      $q: String!
      $withBody: Boolean!
      $withBase: Boolean!
      $withHead: Boolean!
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
            body @include(if: $withBody)
            baseRefName @include(if: $withBase)
            headRefName @include(if: $withHead)
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
		baseBranch,
		graphqlFn,
		withBody,
		withBaseRefName,
		withHeadRefName,
		sponsorFetchMode = "none",
	} = params;

	const qParts = [`repo:${owner}/${repo}`, `is:pr`, `is:merged`];
	if (baseBranch) {
		qParts.push(`base:${baseBranch}`);
	}
	if (sinceDate) {
		qParts.push(`merged:>${sinceDate}`);
	}
	const q = qParts.join(" ");

	const query = buildSearchQuery();
	const data = await paginate(
		graphqlFn,
		query,
		{
			q,
			withBody,
			withBase: withBaseRefName,
			withHead: withHeadRefName,
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
			labels: node.labels, // Keep the nodes structure for categorize compatibility
			author: {
				login: node.author.login,
				type: node.author.__typename, // Normalize __typename to type
				url: node.author.url,
				avatarUrl: node.author.avatarUrl,
				sponsorsListing: node.author.sponsorsListing,
			},
		}),
	);
}
