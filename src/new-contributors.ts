import {
	buildBatchContributorQuery,
	buildPullRequestAuthorQuery,
} from "./graphql/new-contributors-queries";
import type {
	Contributor,
	ContributorCheckResult,
	NewContributor,
	NewContributorsOptions,
	NewContributorsResult,
	PullRequestInfo,
} from "./types/new-contributors";

const DEFAULT_BATCH_SIZE = 10;

function chunk<T>(array: T[], size: number): T[][] {
	const chunks: T[][] = [];
	for (let i = 0; i < array.length; i += size) {
		chunks.push(array.slice(i, i + size));
	}
	return chunks;
}

function generateAlias(login: string): string {
	if (/^\d/.test(login)) {
		return `u_${login.replace(/[^a-zA-Z0-9_]/g, "_")}`;
	}
	return login.replace(/[^a-zA-Z0-9_]/g, "_");
}

async function fetchPullRequestAuthors(
	owner: string,
	repo: string,
	prNumbers: number[],
	graphqlFn: (query: string, variables?: any) => Promise<any>,
): Promise<Map<number, { login: string; isBot: boolean }>> {
	const authorsMap = new Map<number, { login: string; isBot: boolean }>();

	const batches = chunk(prNumbers, 50);
	for (const batch of batches) {
		const query = buildPullRequestAuthorQuery(owner, repo, batch);
		const response = await graphqlFn(query);

		for (const prNumber of batch) {
			const pr = response.repository[`pr${prNumber}`];
			if (pr?.author) {
				authorsMap.set(prNumber, {
					login: pr.author.login,
					isBot: pr.author.__typename === "Bot",
				});
			}
		}
	}

	return authorsMap;
}

async function batchCheckContributors(
	owner: string,
	repo: string,
	contributors: Contributor[],
	releasePRNumbers: Set<number>,
	graphqlFn: (query: string, variables?: any) => Promise<any>,
): Promise<ContributorCheckResult[]> {
	const results: ContributorCheckResult[] = [];

	const batches = chunk(contributors, DEFAULT_BATCH_SIZE);
	for (const batch of batches) {
		const query = buildBatchContributorQuery(owner, repo, batch);
		const response = await graphqlFn(query);

		for (const contributor of batch) {
			const alias = generateAlias(contributor.login);
			const searchResult = response[alias];

			if (!searchResult) {
				continue;
			}

			const totalPRCount = searchResult.issueCount;
			const contributorReleasePRs = contributor.pullRequests.filter((pr) =>
				releasePRNumbers.has(pr.number),
			);
			const releasePRCount = contributorReleasePRs.length;

			let isNewContributor = false;
			let firstPullRequest: PullRequestInfo | undefined;

			if (totalPRCount === 0) {
				continue;
			} else if (totalPRCount === releasePRCount) {
				isNewContributor = true;
				firstPullRequest = contributorReleasePRs[0];
			} else if (searchResult.nodes && searchResult.nodes.length > 0) {
				const historicalPRs = searchResult.nodes;
				const allPRNumbers = new Set([
					...historicalPRs.map((pr: any) => pr.number),
					...contributorReleasePRs.map((pr) => pr.number),
				]);

				if (allPRNumbers.size === releasePRCount) {
					isNewContributor = true;
					firstPullRequest = contributorReleasePRs[0];
				}
			}

			results.push({
				login: contributor.login,
				isBot: contributor.isBot,
				isNewContributor,
				prCount: totalPRCount,
				firstPullRequest,
			});
		}
	}

	return results;
}

function extractContributorsFromPRs(
	pullRequests: any[],
	authorsMap: Map<number, { login: string; isBot: boolean }>,
): Map<string, Contributor> {
	const contributorsMap = new Map<string, Contributor>();

	for (const pr of pullRequests) {
		if (!pr.author?.login) continue;

		const prNumber = pr.number;
		const authorInfo = authorsMap.get(prNumber) || {
			login: pr.author.login,
			isBot: false,
		};

		const login = authorInfo.login;
		if (!contributorsMap.has(login)) {
			contributorsMap.set(login, {
				login,
				isBot: authorInfo.isBot,
				pullRequests: [],
			});
		}

		const contributor = contributorsMap.get(login)!;
		contributor.pullRequests.push({
			number: pr.number,
			title: pr.title,
			url:
				pr.url ||
				`https://github.com/${pr.base?.repo?.full_name}/pull/${pr.number}`,
			mergedAt: pr.merged_at || pr.mergedAt,
			author: {
				login,
				__typename: authorInfo.isBot ? "Bot" : "User",
			},
		});
	}

	return contributorsMap;
}

export async function findNewContributors(
	options: NewContributorsOptions,
): Promise<NewContributorsResult> {
	const { owner, repo, pullRequests, token } = options;

	const graphqlFn = async (query: string, variables?: any): Promise<any> => {
		const res = await fetch("https://api.github.com/graphql", {
			method: "POST",
			headers: {
				Authorization: `Bearer ${token}`,
				"User-Agent": "actionutils-gh-release-notes",
				Accept: "application/vnd.github+json",
				"Content-Type": "application/json",
			},
			body: JSON.stringify({ query, variables }),
		});

		if (!res.ok) {
			const text = await res.text();
			throw new Error(`GitHub GraphQL error: ${res.status} - ${text}`);
		}

		const payload: any = await res.json();
		if (payload.errors) {
			throw new Error(
				`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`,
			);
		}
		return payload.data;
	};

	const prNumbers = pullRequests.map((pr) => pr.number);
	const authorsMap = await fetchPullRequestAuthors(
		owner,
		repo,
		prNumbers,
		graphqlFn,
	);

	const contributorsMap = extractContributorsFromPRs(pullRequests, authorsMap);
	const contributors = Array.from(contributorsMap.values());

	const releasePRNumbers = new Set(prNumbers);

	const checkResults = await batchCheckContributors(
		owner,
		repo,
		contributors,
		releasePRNumbers,
		graphqlFn,
	);

	const newContributors: NewContributor[] = checkResults
		.filter((result) => result.isNewContributor && result.firstPullRequest)
		.map((result) => ({
			login: result.login,
			isBot: result.isBot,
			pullRequests: contributorsMap.get(result.login)?.pullRequests || [],
			firstPullRequest: result.firstPullRequest!,
		}))
		.sort((a, b) => a.login.localeCompare(b.login));

	const apiCallsUsed =
		Math.ceil(prNumbers.length / 50) +
		Math.ceil(contributors.length / DEFAULT_BATCH_SIZE);

	return {
		newContributors,
		totalContributors: contributors.length,
		apiCallsUsed,
	};
}

export function formatNewContributorsSection(
	newContributors: NewContributor[],
): string {
	if (newContributors.length === 0) {
		return "";
	}

	const lines = newContributors.map((contributor) => {
		const mention = `@${contributor.login}`;
		const prUrl = contributor.firstPullRequest.url;
		return `* ${mention} made their first contribution in ${prUrl}`;
	});

	return `## New Contributors\n${lines.join("\n")}`;
}
