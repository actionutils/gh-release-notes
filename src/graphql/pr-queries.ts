/**
 * Sponsor fetch mode controls how sponsor information is retrieved.
 * Using an enum-like type instead of boolean to allow future extensibility.
 *
 * - 'none': Do not fetch sponsor information (default)
 * - 'graphql': Fetch via GraphQL API (requires user token, even without any permissions)
 * - 'html': (Future) May add support for fetching by making HEAD requests to HTML sponsor pages
 *
 * Note: We use this approach instead of a simple boolean to accommodate potential
 * future methods of fetching sponsor information without breaking the API.
 */
export type SponsorFetchMode = "none" | "graphql" | "html";

export type SearchPRParams = {
	owner: string;
	repo: string;
	sinceDate?: string;
	baseBranch?: string;
	graphqlFn: (query: string, variables?: any) => Promise<any>;
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
}: { paginate: any } = require("release-drafter/lib/pagination");

export async function fetchMergedPRs(params: SearchPRParams): Promise<any[]> {
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
	return nodes;
}
