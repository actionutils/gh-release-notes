type GraphQLFn = (query: string, variables?: any) => Promise<any>;

export type FilterByChangedFilesParams = {
	owner: string;
	repo: string;
	pullRequests: any[];
	includePaths: string[];
	graphqlFn: GraphQLFn;
};

function chunk<T>(arr: T[], size: number): T[][] {
	const out: T[][] = [];
	for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
	return out;
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
          nodes { path previousFilePath }
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
): Promise<any[]> {
	const { owner, repo, pullRequests, includePaths, graphqlFn } = params;
	if (includePaths.length === 0 || pullRequests.length === 0)
		return pullRequests;

	const numbers: number[] = pullRequests
		.map((p) => p?.number)
		.filter((n) => typeof n === "number");

	const kept = new Set<number>();
	const perPrCursors = new Map<number, string | null>();
	for (const n of numbers) perPrCursors.set(n, null);

	const CHUNK = 20;
	let pending = new Set(numbers);

	while (pending.size > 0) {
		const batch = Array.from(pending).slice(0, CHUNK);
		const query = buildFilesBatchQuery(batch);
		const variables: any = { owner, name: repo };
		for (const n of batch) {
			variables[`after_pr_${n}`] = perPrCursors.get(n) || null;
		}
		const data = await graphqlFn(query, variables);
		const repoNode = data?.repo;
		for (const n of batch) {
			const prNode = repoNode?.[`pr_${n}`];
			const files = prNode?.files;
			const nodes: any[] = Array.isArray(files?.nodes) ? files.nodes : [];
			let matched = false;
			for (const f of nodes) {
				const cur = String(f?.path || "");
				const prev = String(f?.previousFilePath || "");
				if (
					(cur && matchesIncludePaths(cur, includePaths)) ||
					(prev && matchesIncludePaths(prev, includePaths))
				) {
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
