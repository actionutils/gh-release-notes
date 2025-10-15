/**
 * Filtering utilities for pull requests and contributors
 */

import type { PullRequest } from "./graphql/pr-queries";
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
