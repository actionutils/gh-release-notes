import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";
import { normalizeConfig } from "./github-config-converter";
import { DEFAULT_FALLBACK_CONFIG } from "./constants";
import { ContentLoaderFactory } from "./content-loader";
import {
	findNewContributors,
	formatNewContributorsSection,
} from "./new-contributors";
import { logVerbose } from "./logger";
import {
	categorizePullRequests,
	type MinimalPullRequest,
	type CategorizeConfig,
} from "./categorize";
const {
	validateSchema,
}: { validateSchema: (context: unknown, config: unknown) => unknown } = require("release-drafter/lib/schema");
const {
	generateReleaseInfo,
	findReleases,
}: {
	generateReleaseInfo: (params: unknown) => unknown;
	findReleases: (params: unknown) => Promise<{ draftRelease: unknown; lastRelease: unknown }>;
} = require("release-drafter/lib/releases");

// release-drafter exports sortPullRequests; rely on it being present
const {
	sortPullRequests,
}: {
	sortPullRequests: (pullRequests: unknown[], sortBy?: string, sortDirection?: string) => unknown[];
} = require("release-drafter/lib/sort-pull-requests");

import type { SponsorFetchMode } from "./graphql/pr-queries";
import { TemplateRenderer } from "./template";

export type RunOptions = {
	repo: string;
	config?: string;
	template?: string;
	prevTag?: string;
	tag?: string;
	target?: string;
	token?: string;
	preview?: boolean;
	skipNewContributors?: boolean;
	sponsorFetchMode?: SponsorFetchMode;
	includeAllData?: boolean; // Default: true for library usage, controls whether to fetch extra data like new contributors
};

export type RunResult = {
	owner: string;
	repo: string;
	defaultBranch: string;
	lastRelease: {
		id: unknown;
		tag_name: string;
		created_at: string;
	} | null;
	mergedPullRequests: unknown[];
	categorizedPullRequests: {
		uncategorized: unknown[];
		categories: Array<{ title: string; pullRequests: unknown[]; [key: string]: unknown }>;
	};
	contributors: Array<{ login: string; [key: string]: unknown }>;
	newContributors: Array<{ login: string; firstPullRequest: unknown; [key: string]: unknown }> | null;
	release: {
		name: string;
		tag: string;
		body: string;
		targetCommitish: string;
		resolvedVersion: unknown;
		majorVersion: unknown;
		minorVersion: unknown;
		patchVersion: unknown;
	};
	fullChangelogLink: string;
};

async function ghRest(
	pathname: string,
	{
		token,
		method = "GET" as const,
	}: { token: string; method?: "GET" | "POST" },
): Promise<unknown> {
	const url = new URL(`https://api.github.com${pathname}`);
	const res = await fetch(url, {
		method,
		headers: {
			Authorization: `Bearer ${token}`,
			"User-Agent": "actionutils-gh-release-notes",
			Accept: "application/vnd.github+json",
		},
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub REST ${method} ${url} -> ${res.status}: ${text}`);
	}
	return res.json() as Promise<unknown>;
}

async function ghGraphQL(
	query: string,
	variables: Record<string, unknown>,
	{ token }: { token: string },
): Promise<unknown> {
	const res = await fetch("https://api.github.com/graphql", {
		method: "POST",
		headers: {
			Authorization: `Bearer ${token}`,
			"User-Agent": "actionutils-release-drafter-run",
			Accept: "application/vnd.github+json",
			"Content-Type": "application/json",
		},
		body: JSON.stringify({ query, variables }),
	});
	if (!res.ok) {
		const text = await res.text();
		throw new Error(`GitHub GraphQL -> ${res.status}: ${text}`);
	}
	const payload = await res.json() as { data?: unknown; errors?: unknown[] };
	if (payload.errors) {
		throw new Error(`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`);
	}
	return payload.data;
}

function buildContext({
	owner,
	repo,
	token,
	defaultBranch,
}: {
	owner: string;
	repo: string;
	token: string;
	defaultBranch: string;
}) {
	const octokit = new Octokit({ auth: token });
	const ctx = {
		payload: {
			repository: {
				full_name: `${owner}/${repo}`,
				default_branch: defaultBranch,
			},
		},
		repo: (obj: Record<string, unknown> = {}) => ({ owner, repo, ...obj }),
		log: { info: () => {}, warn: () => {} },
		octokit: octokit as unknown,
	};
	// Provide graphql compatible with release-drafter's expectation
	(ctx as { octokit: { graphql: (query: string, variables: Record<string, unknown>) => Promise<unknown> } }).octokit.graphql = async (query: string, variables: Record<string, unknown>): Promise<unknown> =>
		ghGraphQL(query, variables, { token });
	return ctx as unknown;
}

function parseConfigString(source: string, filename = ""): unknown {
	const lower = filename.toLowerCase();
	if (lower.endsWith(".yml") || lower.endsWith(".yaml")) {
		try {
			const parsed = yaml.load(source);
			logVerbose(
				`[Config] Parsed YAML config${filename ? ` from ${filename}` : ""}`,
			);
			return parsed;
		} catch (error) {
			throw new Error(
				"Failed to parse YAML config: " + (error as Error).message,
			);
		}
	}
	try {
		const parsed = JSON.parse(source);
		logVerbose(
			`[Config] Parsed JSON config${filename ? ` from ${filename}` : ""}`,
		);
		return parsed;
	} catch (error) {
		throw new Error(
			"Config is neither valid JSON nor YAML: " + (error as Error).message,
		);
	}
}

async function getGitHubToken(providedToken?: string): Promise<string> {
	// First try provided token
	if (providedToken) {
		logVerbose("[Auth] Using provided GitHub token");
		return providedToken;
	}

	// Then try environment variables
	if (process.env.GITHUB_TOKEN) {
		logVerbose("[Auth] Using GITHUB_TOKEN from environment");
		return process.env.GITHUB_TOKEN;
	}
	if (process.env.GH_TOKEN) {
		logVerbose("[Auth] Using GH_TOKEN from environment");
		return process.env.GH_TOKEN;
	}

	// Finally try gh auth token
	try {
		const token = execSync("gh auth token", { encoding: "utf8" }).trim();
		if (token) {
			logVerbose("[Auth] Using token from gh auth");
			return token;
		}
	} catch {
		// gh auth token failed, fall through to error
	}

	throw new Error("Missing GITHUB_TOKEN, GH_TOKEN, or gh auth token");
}

function generateFullChangelogLink(params: {
	owner: string;
	repo: string;
	previousTag?: string;
	nextTag: string;
}): string {
	const { owner, repo, previousTag, nextTag } = params;

	if (previousTag) {
		return `https://github.com/${owner}/${repo}/compare/${previousTag}...${nextTag}`;
	}
	return `https://github.com/${owner}/${repo}/commits/${nextTag}`;
}

export async function run(options: RunOptions): Promise<RunResult> {
	const {
		repo: repoNameWithOwner,
		config,
		prevTag,
		tag,
		target,
		preview,
		template,
		sponsorFetchMode: providedSponsorFetchMode,
		includeAllData = true, // Default to true for library usage
	} = options;
	logVerbose("[Run] Resolving GitHub token...");
	const token = await getGitHubToken(options.token);
	logVerbose("[Run] GitHub token resolved");
	if (!repoNameWithOwner) throw new Error("Missing repo (owner/repo)");
	const [owner, repo] = repoNameWithOwner.split("/");
	if (!owner || !repo) throw new Error("Invalid repo, expected owner/repo");

	// Determine the actual sponsor fetch mode
	let sponsorFetchMode: SponsorFetchMode = providedSponsorFetchMode || "auto";
	if (sponsorFetchMode === "auto" || !sponsorFetchMode) {
		// Auto-detection logic
		// If not including all data, sponsor info is not needed
		if (!includeAllData) {
			sponsorFetchMode = "none";
			logVerbose("[Run] Auto sponsor mode: 'none' (not including all data)");
		} else if (token.startsWith("ghs_")) {
			// GitHub App token (including GITHUB_TOKEN in Actions)
			sponsorFetchMode = "html";
			logVerbose("[Run] Auto sponsor mode: 'html' (detected GitHub App token)");
		} else {
			// Non-GitHub App token (user, OAuth, fine-grained PAT, etc.)
			sponsorFetchMode = "graphql";
			logVerbose(
				"[Run] Auto sponsor mode: 'graphql' (detected non-GitHub App token)",
			);
		}
	}

	// Load config (optional). If not provided, try local configs then fallback.
	let cfg: unknown;
	if (config) {
		logVerbose(`[Config] Loading config from: ${config}`);
		// Use config loader for remote config support
		const contentLoader = new ContentLoaderFactory(token);
		const rawCfg = await contentLoader.load(config);
		// For purl sources, extract the filename from the subpath
		let configFilename = config;
		if (config.startsWith("pkg:")) {
			const match = config.match(/#([^?]+)/);
			if (match) {
				configFilename = match[1];
			}
		}
		cfg = parseConfigString(rawCfg, configFilename);
	} else {
		logVerbose("[Config] No config specified; searching default locations");
		// Try release-drafter.yml first
		const releaseDrafterPath = path.resolve(
			process.cwd(),
			".github/release-drafter.yml",
		);
		// Then try GitHub's release.yml or release.yaml
		const githubReleaseYmlPath = path.resolve(
			process.cwd(),
			".github/release.yml",
		);
		const githubReleaseYamlPath = path.resolve(
			process.cwd(),
			".github/release.yaml",
		);

		if (fs.existsSync(releaseDrafterPath)) {
			const raw = fs.readFileSync(releaseDrafterPath, "utf8");
			logVerbose(`[Config] Using ${releaseDrafterPath}`);
			cfg = parseConfigString(raw, releaseDrafterPath);
		} else if (fs.existsSync(githubReleaseYmlPath)) {
			const raw = fs.readFileSync(githubReleaseYmlPath, "utf8");
			logVerbose(`[Config] Using ${githubReleaseYmlPath}`);
			cfg = parseConfigString(raw, githubReleaseYmlPath);
		} else if (fs.existsSync(githubReleaseYamlPath)) {
			const raw = fs.readFileSync(githubReleaseYamlPath, "utf8");
			logVerbose(`[Config] Using ${githubReleaseYamlPath}`);
			cfg = parseConfigString(raw, githubReleaseYamlPath);
		} else {
			logVerbose(
				"[Config] No local config found; using default fallback config",
			);
			cfg = DEFAULT_FALLBACK_CONFIG;
		}
	}

	// Convert GitHub format to release-drafter format if needed
	logVerbose(
		"[Config] Normalizing config (GitHub release.yml vs release-drafter)",
	);
	cfg = normalizeConfig(cfg);

	// Set minimal release-drafter template if custom template is provided
	// This prevents release-drafter from generating its full body
	// We use a single space because release-drafter doesn't allow empty template strings
	if (template && (cfg as { template?: unknown }).template) {
		logVerbose(
			"[Config] Setting minimal release-drafter template (using custom template instead)",
		);
		(cfg as { template: string }).template = " "; // Empty string causes validation error, so use single space
	}

	logVerbose(`[GitHub] Fetching repository info for ${owner}/${repo}`);
	const repoInfo = await ghRest(`/repos/${owner}/${repo}`, { token }) as { default_branch: string };
	const defaultBranch: string = repoInfo.default_branch as string;
	logVerbose(`[GitHub] Default branch: ${defaultBranch}`);

	const context = buildContext({ owner, repo, token, defaultBranch });
	const rdConfig = validateSchema(context, cfg) as Record<string, unknown>;

	let lastRelease: { id: unknown; tag_name: string; created_at: string; published_at?: string } | null = null;
	if (prevTag) {
		logVerbose(`[Releases] Using explicit previous tag: ${prevTag}`);
		const rel = await (context as { octokit: { repos: { getReleaseByTag: (params: { owner: string; repo: string; tag: string }) => Promise<{ data: unknown }> } } }).octokit.repos.getReleaseByTag({
			owner,
			repo,
			tag: prevTag,
		});
		lastRelease = rel.data as { id: unknown; tag_name: string; created_at: string; published_at?: string };
	} else {
		logVerbose(
			`[Releases] Auto-detecting previous release (target=${target || defaultBranch})`,
		);
		// TODO: Support --no-auto-prev flag to disable automatic previous release detection
		// When autoPrev is false, should generate changelog from the beginning of commit history
		// (matching GitHub's "Generate release notes" behavior when no previous tag exists)
		// This would require passing autoPrev from CLI and conditionally skipping findReleases
		const { draftRelease: _draftRelease, lastRelease: lr } =
			await findReleases({
				context,
				targetCommitish: target || defaultBranch,
				filterByCommitish: !!rdConfig["filter-by-commitish"],
				includePreReleases: !!rdConfig["include-pre-releases"],
				tagPrefix: String(rdConfig["tag-prefix"] || ""),
			});
		lastRelease = (lr as { id: unknown; tag_name: string; created_at: string; published_at?: string } | null) || null;
		if (lastRelease?.tag_name) {
			logVerbose(`[Releases] Detected last release: ${lastRelease.tag_name}`);
		} else {
			logVerbose("[Releases] No previous release detected");
		}
	}

	// Generate full changelog link
	const previousTag = prevTag || lastRelease?.tag_name;
	const fullChangelogLink = generateFullChangelogLink({
		owner,
		repo,
		previousTag,
		nextTag: preview
			? target || tag || defaultBranch
			: tag || target || defaultBranch,
	});

	// Replace $FULL_CHANGELOG_LINK placeholder in template if it exists
	if ((rdConfig as { template?: string }).template && (rdConfig as { template: string }).template.includes("$FULL_CHANGELOG_LINK")) {
		logVerbose(
			`[Template] Injecting FULL_CHANGELOG_LINK: ${fullChangelogLink}`,
		);
		(rdConfig as { template: string }).template = (rdConfig as { template: string }).template.replaceAll(
			"$FULL_CHANGELOG_LINK",
			fullChangelogLink,
		);
	}

	const targetCommitish: string = target || defaultBranch;
	logVerbose("[GitHub] Resolving merged pull requests via GraphQL search...");
	const { fetchMergedPRs } = await import("./graphql/pr-queries");
	const { filterByChangedFilesGraphQL } = await import(
		"./graphql/pr-files-queries"
	);

	const needBody = String(rdConfig["change-template"] || "").includes("$BODY");
	const needBase = String(rdConfig["change-template"] || "").includes(
		"$BASE_REF_NAME",
	);
	const needHead = String(rdConfig["change-template"] || "").includes(
		"$HEAD_REF_NAME",
	);

	const sinceDate: string | undefined = lastRelease?.created_at || undefined;
	// Use the repository default branch for base filtering to avoid issues when
	// targetCommitish is a tag or non-branch ref.
	const baseBranchName = String(defaultBranch).replace(/^refs\/heads\//, "");
	let pullRequests = await fetchMergedPRs({
		owner,
		repo,
		sinceDate,
		baseBranch: baseBranchName,
		graphqlFn: ((context as { octokit: { graphql: (query: string, variables?: Record<string, unknown>) => Promise<unknown> } }).octokit.graphql) as any,
		withBody: needBody,
		withBaseRefName: needBase,
		withHeadRefName: needHead,
		sponsorFetchMode,
	}) as MinimalPullRequest[];

	const includePaths: string[] = Array.isArray(rdConfig["include-paths"])
		? rdConfig["include-paths"]
		: [];
	if (includePaths.length > 0 && pullRequests.length > 0) {
		logVerbose(
			`[GitHub] Filtering ${pullRequests.length} PRs by include-paths (${includePaths.length}) via GraphQL files`,
		);
		pullRequests = await filterByChangedFilesGraphQL({
			owner,
			repo,
			pullRequests: pullRequests as unknown as any,
			includePaths,
			graphqlFn: ((context as { octokit: { graphql: (query: string, variables?: Record<string, unknown>) => Promise<unknown> } }).octokit.graphql) as any,
		}) as unknown as MinimalPullRequest[];
	}
	logVerbose(`[GitHub] Collected ${pullRequests.length} merged PRs`);

	// Start sponsor enrichment in parallel (don't await yet)
	let sponsorEnrichmentPromise: Promise<unknown[]> | null = null;
	if (sponsorFetchMode === "html" && pullRequests.length > 0) {
		logVerbose(`[GitHub] Starting HTML sponsor enrichment in background`);
		sponsorEnrichmentPromise = import("./sponsor-html-checker").then(
			({ enrichWithHtmlSponsorData }) =>
				enrichWithHtmlSponsorData(pullRequests as any, 10),
		);
	}

	// Align PR order with release-drafter by applying its exported sorter
	const mergedPullRequestsSorted = Array.isArray(pullRequests)
		? sortPullRequests(
				pullRequests,
				rdConfig["sort-by"] as string | undefined,
				rdConfig["sort-direction"] as string | undefined,
			)
		: pullRequests;

	logVerbose("[Release] Generating release info from commits/PRs...");
	const releaseInfo = generateReleaseInfo({
		context,
		commits: [],
		config: rdConfig,
		lastRelease,
		mergedPullRequests: mergedPullRequestsSorted,
		tag,
		isPreRelease: rdConfig.prerelease,
		latest: rdConfig.latest,
		shouldDraft: true,
		targetCommitish,
	}) as any;
	logVerbose(
		`[Release] Generated release: name=${String(releaseInfo.name || "")} tag=${String(
			releaseInfo.tag || tag || "",
		)}`,
	);

	// Check for $NEW_CONTRIBUTORS placeholder in template
	let newContributorsSection = "";
	let newContributorsData = null;
	let newContributorsPromise: Promise<unknown> | null = null;

	const shouldFetchNewContributors =
		!options.skipNewContributors &&
		(includeAllData ||
			(rdConfig.template && (rdConfig.template as string).includes("$NEW_CONTRIBUTORS")));

	if (shouldFetchNewContributors) {
		// Get the date of the previous release if available
		const prevReleaseDate =
			lastRelease?.published_at || lastRelease?.created_at;

		// Skip new contributors detection if no previous release exists
		// Without a baseline, all contributors would be marked as "new"
		if (prevReleaseDate) {
			logVerbose(
				"[New Contributors] Starting new contributors detection in background...",
			);
			// Start new contributors check in parallel (don't await yet)
			newContributorsPromise = findNewContributors({
				owner,
				repo,
				pullRequests: pullRequests as any,
				token,
				prevReleaseDate,
			});
		} else {
			logVerbose(
				"[New Contributors] Skipping detection - no previous release tag found",
			);
		}
	}

	// Wait for parallel operations to complete
	if (sponsorEnrichmentPromise || newContributorsPromise) {
		logVerbose("[Parallel] Waiting for background operations to complete...");

		// Wait for sponsor enrichment if it was started
		if (sponsorEnrichmentPromise) {
			const enrichedPullRequests = await sponsorEnrichmentPromise;
			if (enrichedPullRequests) {
				pullRequests = enrichedPullRequests as any;
				// Update the sorted version too
				if (Array.isArray(mergedPullRequestsSorted)) {
					// Re-sort with enriched data
					const sortedEnriched = sortPullRequests(
						enrichedPullRequests as any,
						rdConfig["sort-direction"] as string | undefined,
						rdConfig["sort-by"] as string | undefined,
					);
					mergedPullRequestsSorted.length = 0;
					mergedPullRequestsSorted.push(...sortedEnriched);
				}
				logVerbose("[Parallel] Sponsor enrichment completed");
			}
		}

		// Wait for new contributors detection if it was started
		if (newContributorsPromise) {
			const newContributorsResult = await newContributorsPromise as any;
			newContributorsSection = formatNewContributorsSection(
				newContributorsResult.newContributors,
			);
			newContributorsData = newContributorsResult;
			logVerbose("[Parallel] New contributors detection completed");
		}
	}

	// Replace $NEW_CONTRIBUTORS placeholder in the release body if needed
	if (
		rdConfig.template &&
		(rdConfig.template as string).includes("$NEW_CONTRIBUTORS") &&
		releaseInfo.body
	) {
		// If new contributors section is empty, also remove the preceding whitespace/newline
		// to avoid excessive empty lines in the output
		if (newContributorsSection === "") {
			// Remove optional preceding whitespace and newline
			releaseInfo.body = releaseInfo.body.replace(
				/\n?\s*\$NEW_CONTRIBUTORS/g,
				"",
			);
			logVerbose(
				"[Template] Removed $NEW_CONTRIBUTORS placeholder (no new contributors)",
			);
		} else {
			releaseInfo.body = releaseInfo.body.replace(
				"$NEW_CONTRIBUTORS",
				newContributorsSection,
			);
			logVerbose(
				"[Template] Replaced $NEW_CONTRIBUTORS placeholder with generated section",
			);
		}
	}

	// Build contributors directly from PR authors (GraphQL data)
	const excludeContributors: string[] = Array.isArray(
		rdConfig["exclude-contributors"],
	)
		? rdConfig["exclude-contributors"]
		: [];
	const contributorsMap = new Map<string, { login: string; [key: string]: unknown }>();
	for (const pr of mergedPullRequestsSorted || []) {
		const login = (pr as any)?.author?.login as string | undefined;
		if (!login) continue;
		if (excludeContributors.includes(login)) continue;
		if (!contributorsMap.has(login)) {
			const author = (pr as any).author || {};
			contributorsMap.set(login, { ...author });
		}
	}
	const newContributorsOutput = newContributorsData
		? (newContributorsData as any).newContributors.map(
				(c: { login: string; firstPullRequest: unknown }) => {
					const base = contributorsMap.get(c.login);
					return { ...base, firstPullRequest: c.firstPullRequest };
				},
			)
		: null;

	// Build categorized pull requests for JSON output using local workaround
	const categorizedPullRequests = categorizePullRequests(
		(mergedPullRequestsSorted || []) as MinimalPullRequest[],
		rdConfig as CategorizeConfig,
	);

	// Create the output data structure once
	const result: RunResult = {
		owner,
		repo,
		defaultBranch,
		lastRelease: lastRelease
			? {
					id: lastRelease.id,
					tag_name: lastRelease.tag_name,
					created_at: lastRelease.created_at,
				}
			: null,
		mergedPullRequests: mergedPullRequestsSorted,
		categorizedPullRequests,
		contributors: Array.from(contributorsMap.values()),
		newContributors: newContributorsOutput,
		release: {
			name: releaseInfo.name,
			tag: releaseInfo.tag,
			body: releaseInfo.body,
			targetCommitish: releaseInfo.targetCommitish,
			resolvedVersion: releaseInfo.resolvedVersion,
			majorVersion: releaseInfo.majorVersion,
			minorVersion: releaseInfo.minorVersion,
			patchVersion: releaseInfo.patchVersion,
		},
		fullChangelogLink,
	};

	// Handle template rendering - this overrides release.body
	if (template) {
		logVerbose("[Run] Rendering template");
		const renderer = new TemplateRenderer(token);
		const renderedBody = await renderer.loadAndRender(template, result);
		// Update release.body with the rendered template
		result.release.body = renderedBody;
	}

	logVerbose("[Run] Completed successfully");
	return result;
}
