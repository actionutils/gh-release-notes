import type { PullRequest } from './pr-queries';

interface GraphQLFileNode {
	path: string;
	previousFilePath?: string | null;
}

interface GraphQLFilesResponse {
	pageInfo: { hasNextPage: boolean; endCursor: string | null };
	nodes: GraphQLFileNode[];
}

interface GraphQLPullRequestFiles {
	files?: GraphQLFilesResponse;
}

interface GraphQLResponse {
	repo?: {
		[key: string]: GraphQLPullRequestFiles;
	};
}

interface GraphQLVariables {
	owner: string;
	name: string;
	[key: string]: string | null;
}

type GraphQLFn = (query: string, variables?: GraphQLVariables) => Promise<GraphQLResponse>;

export interface FilterByChangedFilesParams {
	owner: string;
	repo: string;
	pullRequests: PullRequest[];
	includePaths: string[];
	graphqlFn: GraphQLFn;
}

function buildFilesBatchQuery(
	prNumbers: number[],
	varPrefix = "after",
): string {
	const prQueries = prNumbers
		.map(
			(n) => `
      pr_${n}: pullRequest(number: ${n}) {
        files(first: 100, after: $${varPrefix}_pr_${n}) {
          pageInfo { hasNextPage endCursor }
          nodes { path }
        }
      }
    `,
		)
		.join("\n");
	return /* GraphQL */ `
    query FilesForPRs($owner: String!, $name: String!, ${prNumbers
			.map((n) => `$${varPrefix}_pr_${n}: String`)
			.join(", ")}) {
      repo: repository(owner: $owner, name: $name) {
        ${prQueries}
      }
    }
  `;
}

function matchesIncludePaths(path: string, includes: string[]): boolean {
	for (const p of includes) {
		if (path.startsWith(p)) return true;
	}
	return false;
}

export async function filterByChangedFilesGraphQL(
	params: FilterByChangedFilesParams,
): Promise<PullRequest[]> {
	const { owner, repo, pullRequests, includePaths, graphqlFn } = params;
	if (includePaths.length === 0 || pullRequests.length === 0)
		return pullRequests;

	const numbers: number[] = pullRequests.map((p) => p.number);

	const kept = new Set<number>();
	const perPrCursors = new Map<number, string | null>();
	for (const n of numbers) perPrCursors.set(n, null);

	const CHUNK = 20;
	let pending = new Set(numbers);

	while (pending.size > 0) {
		const batch = Array.from(pending).slice(0, CHUNK);
		const query = buildFilesBatchQuery(batch);
		const variables: GraphQLVariables = { owner, name: repo };
		for (const n of batch) {
			variables[`after_pr_${n}`] = perPrCursors.get(n) || null;
		}
		const data = await graphqlFn(query, variables);
		const repoNode = data?.repo;
		for (const n of batch) {
			const prNode = repoNode?.[`pr_${n}`];
			const files = prNode?.files;
			const nodes = files?.nodes || [];
			let matched = false;
			for (const f of nodes) {
				if (f.path && matchesIncludePaths(f.path, includePaths)) {
					matched = true;
					break;
				}
			}
			if (matched) {
				kept.add(n);
				pending.delete(n);
				continue;
			}
			const pageInfo = files?.pageInfo;
			if (pageInfo?.hasNextPage) {
				perPrCursors.set(n, pageInfo.endCursor || null);
			} else {
				// no match and no more pages
				pending.delete(n);
			}
		}
	}

	const result = pullRequests.filter((p) => kept.has(p.number));
	return result;
}
