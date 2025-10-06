/**
 * Workaround: Local copy of release-drafter's categorize logic
 *
 * This re-implements the categorizePullRequests behavior from
 * release-drafter v6.1.0 (lib/releases.js) because the function is not
 * exported upstream. Once upstream exposes a stable API for categorization,
 * we should replace this file with direct imports to reduce maintenance.
 */

export type LabelNode = { name: string };
export type Labels = { nodes: LabelNode[] };
export type MinimalPullRequest = { labels: Labels } & Record<string, unknown>;

export type Category = {
	title: string;
	labels: string[];
	"collapse-after"?: number;
	[k: string]: unknown;
};

export type CategorizeConfig = {
	"exclude-labels"?: string[];
	"include-labels"?: string[];
	categories?: Category[];
};

export type CategorizedResult<T extends MinimalPullRequest> = {
	uncategorized: T[];
	categories: Array<Category & { pullRequests: T[] }>;
};

function getFilterExcludedPullRequests<T extends MinimalPullRequest>(
	excludeLabels: string[],
) {
	return (pullRequest: T) => {
		const labels = pullRequest.labels.nodes;
		if (labels.some((label) => excludeLabels.includes(label.name))) {
			return false;
		}
		return true;
	};
}

function getFilterIncludedPullRequests<T extends MinimalPullRequest>(
	includeLabels: string[],
) {
	return (pullRequest: T) => {
		const labels = pullRequest.labels.nodes;
		if (
			includeLabels.length === 0 ||
			labels.some((label) => includeLabels.includes(label.name))
		) {
			return true;
		}
		return false;
	};
}

/**
 * Categorize PRs using release-drafter compatible config.
 * Returns both uncategorized PRs and per-category PR arrays.
 */
export function categorizePullRequests<T extends MinimalPullRequest>(
	pullRequests: T[],
	config: CategorizeConfig,
): CategorizedResult<T> {
	const excludeLabels: string[] = config?.["exclude-labels"] ?? [];
	const includeLabels: string[] = config?.["include-labels"] ?? [];
	const categories: Category[] = Array.isArray(config?.categories)
		? (config.categories as Category[])
		: [];

	const allCategoryLabels = new Set<string>(
		categories.flatMap((category) => category.labels || []),
	);

	const uncategorizedPullRequests: T[] = [];
	const categorizedPullRequests = [...categories].map((category) => ({
		...category,
		pullRequests: [] as T[],
	}));

	const uncategorizedCategoryIndex = categories.findIndex(
		(category) => (category.labels?.length ?? 0) === 0,
	);

	const filterUncategorizedPullRequests = (pullRequest: T) => {
		const labels = pullRequest.labels.nodes;

		if (
			labels.length === 0 ||
			!labels.some((label: any) => allCategoryLabels.has(label.name))
		) {
			if (uncategorizedCategoryIndex === -1) {
				uncategorizedPullRequests.push(pullRequest);
			} else {
				categorizedPullRequests[uncategorizedCategoryIndex].pullRequests.push(
					pullRequest,
				);
			}
			return false;
		}
		return true;
	};

	const filteredPullRequests = pullRequests
		.filter(getFilterExcludedPullRequests<T>(excludeLabels))
		.filter(getFilterIncludedPullRequests<T>(includeLabels))
		.filter((pullRequest) => filterUncategorizedPullRequests(pullRequest));

	for (const category of categorizedPullRequests) {
		for (const pullRequest of filteredPullRequests) {
			const labels = pullRequest.labels.nodes;
			if (
				labels.some((label) => (category.labels || []).includes(label.name))
			) {
				category.pullRequests.push(pullRequest);
			}
		}
	}

	return {
		uncategorized: uncategorizedPullRequests,
		categories: categorizedPullRequests,
	};
}
