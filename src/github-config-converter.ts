/**
 * Converts GitHub's official release.yml format to release-drafter format
 */

import { logVerbose } from "./logger";
import { DEFAULT_FALLBACK_CONFIG } from "./constants";

interface GitHubReleaseCategory {
	title: string;
	labels: string[];
	exclude?: {
		labels?: string[];
		authors?: string[];
	};
}

interface GitHubReleaseConfig {
	changelog: {
		exclude?: {
			labels?: string[];
			authors?: string[];
		};
		categories?: GitHubReleaseCategory[];
	};
}

interface ReleaseDrafterCategory {
	title: string;
	labels?: string[];
	label?: string;
}

interface ReleaseDrafterConfig {
	template?: string;
	categories?: ReleaseDrafterCategory[];
	"exclude-labels"?: string[];
	"include-labels"?: string[];
	"exclude-contributors"?: string[];
	[key: string]: unknown;
}

/**
 * Detects if the config is in GitHub's release.yml format
 */
export function isGitHubReleaseConfig(
	config: unknown,
): config is GitHubReleaseConfig {
	return !!(
		config &&
		typeof config === "object" &&
		"changelog" in config &&
		config.changelog &&
		typeof config.changelog === "object"
	);
}

/**
 * Converts GitHub's release.yml format to release-drafter format
 */
export function convertGitHubToReleaseDrafter(
	githubConfig: GitHubReleaseConfig,
): ReleaseDrafterConfig {
	// Start with the default fallback config as base
	const releaseDrafterConfig: ReleaseDrafterConfig = {
		...DEFAULT_FALLBACK_CONFIG,
	};

	// Convert excluded labels
	if (githubConfig.changelog.exclude?.labels) {
		releaseDrafterConfig["exclude-labels"] =
			githubConfig.changelog.exclude.labels;
	}

	// Convert excluded authors/contributors
	if (githubConfig.changelog.exclude?.authors) {
		releaseDrafterConfig["exclude-contributors"] =
			githubConfig.changelog.exclude.authors;
	}

	// Convert categories
	if (githubConfig.changelog.categories) {
		releaseDrafterConfig.categories = githubConfig.changelog.categories.map(
			(category) => {
				const rdCategory: ReleaseDrafterCategory = {
					title: category.title,
				};

				// Handle labels
				if (category.labels && category.labels.length > 0) {
					// Check if it's a wildcard category
					if (category.labels.length === 1 && category.labels[0] === "*") {
						// For wildcard categories in GitHub format,
						// release-drafter treats empty labels as "uncategorized"
						// which effectively matches all remaining PRs
						// So we don't set labels at all for wildcard
					} else {
						rdCategory.labels = category.labels;
					}
				}

				// Handle category-level exclusions
				// Note: release-drafter doesn't support per-category exclusions directly
				// However, for wildcard categories, release-drafter's behavior of only including
				// uncategorized items effectively provides similar filtering
				if (category.exclude?.labels || category.exclude?.authors) {
					logVerbose(
						`Category "${category.title}" has exclusions which are not directly supported by release-drafter. ` +
							"Global exclusions will be applied instead. " +
							(category.labels?.includes("*")
								? "Note: Since this is a wildcard category, release-drafter will only include uncategorized items, which may provide similar filtering."
								: ""),
					);
				}

				return rdCategory;
			},
		);
	}

	return releaseDrafterConfig;
}

/**
 * Processes a config that might be in either format
 */
export function normalizeConfig(config: unknown): unknown {
	if (isGitHubReleaseConfig(config)) {
		logVerbose(
			"Detected GitHub release.yml format, converting to release-drafter format...",
		);
		return convertGitHubToReleaseDrafter(config);
	}
	return config;
}
