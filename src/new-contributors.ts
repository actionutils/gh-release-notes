import { buildBatchContributorQuery } from "./graphql/new-contributors-queries";
import type {
	Contributor,
	ContributorCheckResult,
	NewContributor,
	NewContributorsOptions,
	NewContributorsResult,
	PullRequestInfo,
} from "./types/new-contributors";
import { logVerbose } from "./logger";

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


async function batchCheckContributors(
	owner: string,
	repo: string,
	contributors: Contributor[],
	releasePRNumbers: Set<number>,
	graphqlFn: (query: string, variables?: any) => Promise<any>,
): Promise<ContributorCheckResult[]> {
	const results: ContributorCheckResult[] = [];

	logVerbose(`[New Contributors] Checking ${contributors.length} contributors for first-time contributions`);
	const batches = chunk(contributors, DEFAULT_BATCH_SIZE);
	for (const batch of batches) {
		const query = buildBatchContributorQuery(owner, repo, batch);
		logVerbose(`[New Contributors] Checking batch of ${batch.length} contributors: ${batch.map(c => c.login).join(', ')}`);
		const response = await graphqlFn(query);

		for (const contributor of batch) {
			const alias = generateAlias(contributor.login);
			const searchResult = response[alias];

			if (!searchResult) {
				logVerbose(`[New Contributors] No search result for ${contributor.login} (alias: ${alias})`);
				continue;
			}

			const totalPRCount = searchResult.issueCount;
			logVerbose(`[New Contributors] ${contributor.login}: ${totalPRCount} total PRs found`);
			const contributorReleasePRs = contributor.pullRequests.filter((pr) =>
				releasePRNumbers.has(pr.number),
			);
			const releasePRCount = contributorReleasePRs.length;

			let isNewContributor = false;
			let firstPullRequest: PullRequestInfo | undefined;

			if (totalPRCount === 0) {
				// No PRs found at all (shouldn't happen)
				continue;
			} else if (totalPRCount === releasePRCount) {
				// All of user's PRs are in this release = new contributor
				isNewContributor = true;
				firstPullRequest = contributorReleasePRs[0];
				logVerbose(`[New Contributors] ${contributor.login} is a new contributor (${totalPRCount} total PRs, all in this release)`);
			} else if (totalPRCount > releasePRCount) {
				logVerbose(`[New Contributors] ${contributor.login} is NOT new (${totalPRCount} total PRs, ${releasePRCount} in this release)`);
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
	owner: string,
	repo: string,
	pullRequests: any[],
): Map<string, Contributor> {
	const contributorsMap = new Map<string, Contributor>();

	for (const pr of pullRequests) {
		if (!pr.author?.login) continue;

		const login = pr.author.login;
		const isBot = pr.author.__typename === "Bot";

		if (!contributorsMap.has(login)) {
			contributorsMap.set(login, {
				login,
				isBot,
				pullRequests: [],
			});
		}

		const contributor = contributorsMap.get(login)!;
		const repoName = pr.baseRepository?.nameWithOwner || `${owner}/${repo}`;
		contributor.pullRequests.push({
			number: pr.number,
			title: pr.title,
			url: pr.url || `https://github.com/${repoName}/pull/${pr.number}`,
			mergedAt: pr.merged_at || pr.mergedAt,
			author: {
				login,
				__typename: isBot ? "Bot" : "User",
			},
		});
	}

	return contributorsMap;
}

export async function findNewContributors(
	options: NewContributorsOptions,
): Promise<NewContributorsResult> {
	const { owner, repo, pullRequests, token } = options;
	logVerbose(`[New Contributors] Starting detection for ${pullRequests.length} PRs in ${owner}/${repo}`);

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

	const contributorsMap = extractContributorsFromPRs(owner, repo, pullRequests);
	const contributors = Array.from(contributorsMap.values());

	const prNumbers = pullRequests.map((pr) => pr.number);
	const releasePRNumbers = new Set(prNumbers);

	const checkResults = await batchCheckContributors(
		owner,
		repo,
		contributors,
		releasePRNumbers,
		graphqlFn,
	);

	logVerbose(`[New Contributors] Found ${checkResults.filter(r => r.isNewContributor).length} new contributors out of ${contributors.length} total`);

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
