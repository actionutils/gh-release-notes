/**
 * Filtering utilities for pull requests and contributors
 */

import type { PullRequest } from "./graphql/pr-queries";
import type { Author } from "./core";
import { logVerbose } from "./logger";

/**
 * Filter pull requests by excluded labels
 */
export function filterPullRequestsByExcludeLabels(
	pullRequests: PullRequest[],
	excludeLabels: string[],
): PullRequest[] {
	if (excludeLabels.length === 0) {
		return pullRequests;
	}

	const filtered = pullRequests.filter((pr) => {
		const prLabels = pr.labels?.nodes?.map((node) => node.name) || [];
		return !prLabels.some((label) => excludeLabels.includes(label));
	});

	logVerbose(
		`[Filtering] Applied exclude-labels filter, ${filtered.length} PRs remaining`,
	);
	return filtered;
}

/**
 * Filter pull requests by included labels
 */
export function filterPullRequestsByIncludeLabels(
	pullRequests: PullRequest[],
	includeLabels: string[],
): PullRequest[] {
	if (includeLabels.length === 0) {
		return pullRequests;
	}

	const filtered = pullRequests.filter((pr) => {
		const prLabels = pr.labels?.nodes?.map((node) => node.name) || [];
		return prLabels.some((label) => includeLabels.includes(label));
	});

	logVerbose(
		`[Filtering] Applied include-labels filter, ${filtered.length} PRs remaining`,
	);
	return filtered;
}

/**
 * Filter contributors by excluded users
 */
export function filterContributorsByExcluded(
	contributors: Author[],
	excludeContributors: string[],
): Author[] {
	if (excludeContributors.length === 0) {
		return contributors;
	}

	return contributors.filter(
		(author) => !excludeContributors.includes(author.login || ""),
	);
}

/**
 * Filter new contributors by excluded users
 */
export function filterNewContributorsByExcluded(
	newContributors: Array<{
		login: string;
		firstPullRequest: {
			number: number;
			title: string;
			url: string;
			mergedAt: string;
		};
	}>,
	excludeContributors: string[],
): Array<{
	login: string;
	firstPullRequest: {
		number: number;
		title: string;
		url: string;
		mergedAt: string;
	};
}> {
	if (excludeContributors.length === 0) {
		return newContributors;
	}

	return newContributors.filter((c) => !excludeContributors.includes(c.login));
}

/**
 * Apply label filters to pull requests
 */
export function applyLabelFilters(
	pullRequests: PullRequest[],
	config: {
		"exclude-labels"?: string[];
		"include-labels"?: string[];
	},
): PullRequest[] {
	const excludeLabels = Array.isArray(config["exclude-labels"])
		? config["exclude-labels"]
		: [];
	const includeLabels = Array.isArray(config["include-labels"])
		? config["include-labels"]
		: [];

	let filtered = pullRequests;
	filtered = filterPullRequestsByExcludeLabels(filtered, excludeLabels);
	filtered = filterPullRequestsByIncludeLabels(filtered, includeLabels);

	return filtered;
}
