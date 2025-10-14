import { buildBatchContributorQuery } from "./graphql/new-contributors-queries";
import { logVerbose } from "./logger";
import type { PullRequest } from "./graphql/pr-queries";

// Internal types for new-contributors module
interface PullRequestInfo {
	number: number;
	title: string;
	url: string;
	mergedAt: string;
}

interface ContributorCheckResult {
	login: string;
	isNewContributor: boolean;
	prCount: number;
	firstPullRequest?: PullRequestInfo;
}

export interface NewContributorsOptions {
	owner: string;
	repo: string;
	pullRequests: PullRequest[];
	token: string;
	prevReleaseDate?: string;
}

export interface NewContributorsResult {
	newContributors: Array<{
		login: string;
		firstPullRequest: PullRequestInfo;
	}>;
	totalContributors: number;
	apiCallsUsed: number;
}

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
	contributorData: Map<string, { type: string; pullRequests: PullRequestInfo[] }>,
	releasePRNumbers: Set<number>,
	graphqlFn: (query: string, variables?: Record<string, unknown>) => Promise<Record<string, unknown>>,
	prevReleaseDate?: string,
): Promise<ContributorCheckResult[]> {
	const results: ContributorCheckResult[] = [];

	logVerbose(
		`[New Contributors] Checking ${contributorData.size} contributors for first-time contributions`,
	);
	if (prevReleaseDate) {
		logVerbose(
			`[New Contributors] Using previous release date: ${prevReleaseDate}`,
		);
	}

	const contributors = Array.from(contributorData.entries()).map(([login, data]) => ({
		login,
		isBot: data.type === "Bot",
		pullRequests: data.pullRequests
	}));

	const batches = chunk(contributors, DEFAULT_BATCH_SIZE);
	for (const batch of batches) {
		const query = buildBatchContributorQuery(
			owner,
			repo,
			batch,
			prevReleaseDate,
		);
		logVerbose(
			`[New Contributors] Checking batch of ${batch.length} contributors: ${batch.map((c) => c.login).join(", ")}`,
		);
		const response = await graphqlFn(query);

		for (const contributor of batch) {
			const alias = generateAlias(contributor.login);
			const searchResult = response[alias] as { issueCount: number; nodes?: unknown[] };

			if (!searchResult || typeof searchResult !== 'object') {
				logVerbose(
					`[New Contributors] No search result for ${contributor.login} (alias: ${alias})`,
				);
				continue;
			}

			const contributorReleasePRs = contributor.pullRequests.filter((pr) =>
				releasePRNumbers.has(pr.number),
			);

			let isNewContributor = false;
			let firstPullRequest: PullRequestInfo | undefined;

			if (prevReleaseDate) {
				// When we have a previous release date, check if user has any PRs before that date
				const prsBeforeDate = searchResult.issueCount || 0;

				if (prsBeforeDate === 0) {
					// No PRs before the prev release = new contributor
					// Use the earliest PR from current release as their first contribution
					isNewContributor = true;
					// Sort PRs by mergedAt date to get the earliest one
					const sortedPRs = [...contributorReleasePRs].sort(
						(a, b) =>
							new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime(),
					);
					firstPullRequest = sortedPRs[0];
					logVerbose(
						`[New Contributors] ${contributor.login} is a new contributor (0 PRs before ${prevReleaseDate})`,
					);
				} else {
					logVerbose(
						`[New Contributors] ${contributor.login} is NOT new (${prsBeforeDate} PRs before ${prevReleaseDate})`,
					);
				}
			} else {
				// When we don't have a previous release date, check if all PRs are in current release
				const totalPRCount = searchResult.issueCount || 0;
				const releasePRCount = contributorReleasePRs.length;

				logVerbose(
					`[New Contributors] ${contributor.login}: ${totalPRCount} total PRs found, ${releasePRCount} in current release`,
				);

				if (totalPRCount === 0) {
					// No PRs found at all (shouldn't happen)
					continue;
				} else if (totalPRCount === releasePRCount) {
					// All of user's PRs are in this release = new contributor
					isNewContributor = true;
					// Sort PRs by mergedAt date to get the earliest one
					const sortedPRs = [...contributorReleasePRs].sort(
						(a, b) =>
							new Date(a.mergedAt).getTime() - new Date(b.mergedAt).getTime(),
					);
					firstPullRequest = sortedPRs[0];
					logVerbose(
						`[New Contributors] ${contributor.login} is a new contributor (all ${totalPRCount} PRs are in this release)`,
					);
				} else {
					logVerbose(
						`[New Contributors] ${contributor.login} is NOT new (${totalPRCount} total PRs, only ${releasePRCount} in this release)`,
					);
				}
			}

			results.push({
				login: contributor.login,
				isNewContributor,
				prCount: searchResult.issueCount || 0,
				firstPullRequest,
			});
		}
	}

	return results;
}

function extractContributorsFromPRs(
	pullRequests: PullRequest[],
): Map<string, { type: string; pullRequests: PullRequestInfo[] }> {
	const contributorsMap = new Map<string, { type: string; pullRequests: PullRequestInfo[] }>();

	for (const pr of pullRequests) {
		if (!pr.author?.login) continue;

		const login = pr.author.login;
		const type = pr.author.type;

		if (!contributorsMap.has(login)) {
			contributorsMap.set(login, {
				type,
				pullRequests: [],
			});
		}

		const contributor = contributorsMap.get(login)!;
		contributor.pullRequests.push({
			number: pr.number,
			title: pr.title,
			url: pr.url,
			mergedAt: pr.mergedAt,
		});
	}

	return contributorsMap;
}

export async function findNewContributors(
	options: NewContributorsOptions,
): Promise<NewContributorsResult> {
	const { owner, repo, pullRequests, token, prevReleaseDate } = options;
	logVerbose(
		`[New Contributors] Starting detection for ${pullRequests.length} PRs in ${owner}/${repo}`,
	);

	const graphqlFn = async (query: string, variables?: Record<string, unknown>): Promise<Record<string, unknown>> => {
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

		const payload = await res.json() as { data?: Record<string, unknown>; errors?: unknown[] };
		if (payload.errors) {
			throw new Error(
				`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`,
			);
		}
		return payload.data || {};
	};

	const contributorData = extractContributorsFromPRs(pullRequests);
	logVerbose(
		`[New Contributors] Extracted ${contributorData.size} unique contributors from PRs`,
	);

	const prNumbers = pullRequests.map((pr) => pr.number);
	const releasePRNumbers = new Set(prNumbers);

	const checkResults = await batchCheckContributors(
		owner,
		repo,
		contributorData,
		releasePRNumbers,
		graphqlFn,
		prevReleaseDate,
	);

	logVerbose(
		`[New Contributors] Found ${checkResults.filter((r) => r.isNewContributor).length} new contributors out of ${contributorData.size} total`,
	);

	const newContributors = checkResults
		.filter((result) => result.isNewContributor && result.firstPullRequest)
		.map((result) => ({
			login: result.login,
			firstPullRequest: result.firstPullRequest!,
		}))
		.sort((a, b) => a.login.localeCompare(b.login));

	const apiCallsUsed =
		Math.ceil(prNumbers.length / 50) +
		Math.ceil(contributorData.size / DEFAULT_BATCH_SIZE);

	logVerbose(`[New Contributors] Total API calls used: ${apiCallsUsed}`);

	return {
		newContributors,
		totalContributors: contributorData.size,
		apiCallsUsed,
	};
}

export function formatNewContributorsSection(
	newContributors: Array<{ login: string; firstPullRequest: PullRequestInfo }>,
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
