export type SearchPRParams = {
	owner: string;
	repo: string;
	sinceDate?: string;
	graphqlFn: (query: string, variables?: any) => Promise<any>;
	withBody: boolean;
	withURL: boolean;
	withBaseRefName: boolean;
	withHeadRefName: boolean;
};

function buildSearchQuery(): string {
	return /* GraphQL */ `
    query SearchMergedPRs(
      $q: String!
      $withBody: Boolean!
      $withURL: Boolean!
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
            url @include(if: $withURL)
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

export async function fetchMergedPRs(params: SearchPRParams): Promise<any[]> {
	const {
		owner,
		repo,
		sinceDate,
		graphqlFn,
		withBody,
		withURL,
		withBaseRefName,
		withHeadRefName,
	} = params;

	const qParts = [`repo:${owner}/${repo}`, `is:pr`, `is:merged`];
	if (sinceDate) {
		qParts.push(`merged:>${sinceDate}`);
	}
	const q = qParts.join(" ");

	const query = buildSearchQuery();
	let after: string | null = null;
	const prs: any[] = [];
	// paginate search
	// eslint-disable-next-line no-constant-condition
	while (true) {
		const variables = {
			q,
			withBody,
			withURL,
			withBase: withBaseRefName,
			withHead: withHeadRefName,
			after,
		};
		const data = await graphqlFn(query, variables);
		const search = data?.search;
		const nodes = Array.isArray(search?.nodes) ? search.nodes : [];
		for (const node of nodes) {
			// Node is a PullRequest per selection set
			prs.push(node);
		}
		const pageInfo = search?.pageInfo;
		if (!pageInfo?.hasNextPage) break;
		after = pageInfo.endCursor || null;
	}
	return prs;
}
