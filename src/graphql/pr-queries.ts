export type SearchPRParams = {
	owner: string;
	repo: string;
	sinceDate?: string;
	baseBranch?: string;
	graphqlFn: (query: string, variables?: any) => Promise<any>;
	withBody: boolean;
	withBaseRefName: boolean;
	withHeadRefName: boolean;
};

function buildSearchQuery(): string {
	return /* GraphQL */ `
    query SearchMergedPRs(
      $q: String!
      $withBody: Boolean!
      $withBase: Boolean!
      $withHead: Boolean!
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
              ... on User { avatarUrl sponsorsListing { url } }
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
			after: null,
		},
		["search"],
	);
	const nodes = Array.isArray(data?.search?.nodes) ? data.search.nodes : [];
	return nodes;
}
