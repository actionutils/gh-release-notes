import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import type { RestEndpointMethodTypes } from "@octokit/rest";
import yaml from "js-yaml";
import { normalizeConfig } from "./github-config-converter";
import { DEFAULT_FALLBACK_CONFIG } from "./constants";
import { ContentLoaderFactory } from "./content-loader";
import {
	findNewContributors,
	formatNewContributorsSection,
} from "./new-contributors";
import { logVerbose } from "./logger";
import { categorizePullRequests, type CategorizeConfig } from "./categorize";
import { enrichWithHtmlSponsorData } from "./sponsor-html-checker";
// Type definitions for release-drafter library functions
interface ReleaseDrafterContext {
	payload: {
		repository: {
			full_name: string;
			default_branch: string;
		};
	};
	repo: (obj?: Record<string, unknown>) => Record<string, unknown>;
	log: { info: () => void; warn: () => void };
	octokit: {
		graphql: (
			query: string,
			variables: Record<string, unknown>,
		) => Promise<unknown>;
		repos: {
			getReleaseByTag: (params: {
				owner: string;
				repo: string;
				tag: string;
			}) => Promise<{ data: unknown }>;
		};
	};
}

interface ReleaseDrafterConfig {
	"change-template"?: string;
	"filter-by-commitish"?: boolean;
	"include-pre-releases"?: boolean;
	"tag-prefix"?: string;
	"exclude-labels"?: string[];
	"include-labels"?: string[];
	"exclude-contributors"?: string[];
	"include-paths"?: string[];
	"sort-by"?: string;
	"sort-direction"?: string;
	template?: string;
	prerelease?: boolean;
	latest?: boolean;
	[key: string]: unknown;
}

interface FindReleasesParams {
	context: ReleaseDrafterContext;
	targetCommitish: string;
	filterByCommitish: boolean;
	includePreReleases: boolean;
	tagPrefix: string;
}

interface GenerateReleaseInfoParams {
	context: ReleaseDrafterContext;
	commits: unknown[];
	config: ReleaseDrafterConfig;
	lastRelease: LastRelease;
	mergedPullRequests: MergedPullRequest[];
	tag?: string;
	isPreRelease?: boolean;
	latest?: boolean;
	shouldDraft: boolean;
	targetCommitish: string;
}

const {
	validateSchema,
}: {
	validateSchema: (
		context: ReleaseDrafterContext,
		config: unknown,
	) => ReleaseDrafterConfig;
} = require("release-drafter/lib/schema");
const {
	generateReleaseInfo,
	findReleases,
}: {
	generateReleaseInfo: (params: GenerateReleaseInfoParams) => ReleaseInfo & {
		resolvedVersion: string;
		majorVersion: number;
		minorVersion: number;
		patchVersion: number;
	};
	findReleases: (
		params: FindReleasesParams,
	) => Promise<{ draftRelease: unknown; lastRelease: LastRelease }>;
} = require("release-drafter/lib/releases");

// release-drafter exports sortPullRequests; rely on it being present
const {
	sortPullRequests,
}: {
	sortPullRequests: (
		pullRequests: MergedPullRequest[],
		sortBy?: string,
		sortDirection?: string,
	) => MergedPullRequest[];
} = require("release-drafter/lib/sort-pull-requests");

import type { SponsorFetchMode, PullRequest } from "./graphql/pr-queries";
import { TemplateRenderer } from "./template";

// Type alias for GitHub release response used across helpers
type GitHubRelease =
	RestEndpointMethodTypes["repos"]["getReleaseByTag"]["response"]["data"];

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

// Type for label in final output (flattened)
export type Label = string;

// Type for MergedPullRequest - flattens labels for final output
export type MergedPullRequest = Omit<PullRequest, "labels"> & {
	labels?: Label[];
};

// Export types for external consumers
export type Author = PullRequest["author"];

// Type for release version information
export type ReleaseVersion = {
	resolved: string;
	major: number;
	minor: number;
	patch: number;
};

// Type for categorized pull requests
export type CategorizedPullRequests = {
	uncategorized: MergedPullRequest[];
	categories: Array<{
		title: string;
		labels?: string[];
		collapse_after?: number;
		pullRequests: MergedPullRequest[];
	}>;
};

// Type for new contributor - author data plus firstPullRequest
export type NewContributor = Author & {
	firstPullRequest: {
		number: number;
		title: string;
		url: string;
		mergedAt: string;
	};
};

// Type for last release information
export type LastRelease = {
	id: number | string;
	tag_name: string;
	created_at: string;
	published_at?: string;
	name?: string;
	prerelease?: boolean;
} | null;

// Type for release information
export type ReleaseInfo = {
	name: string;
	tag: string;
	body: string;
	targetCommitish: string;
	resolvedVersion: string;
	majorVersion: number;
	minorVersion: number;
	patchVersion: number;
};

export type RunResult = {
	owner: string;
	repo: string;
	defaultBranch: string;
	lastRelease: LastRelease;
	mergedPullRequests: MergedPullRequest[];
	categorizedPullRequests: CategorizedPullRequests;
	contributors: Author[];
	newContributors: NewContributor[] | null;
	release: ReleaseInfo;
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
	const payload = (await res.json()) as { data?: unknown; errors?: unknown[] };
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
}): ReleaseDrafterContext {
	const octokit = new Octokit({ auth: token });
	const ctx: ReleaseDrafterContext = {
		payload: {
			repository: {
				full_name: `${owner}/${repo}`,
				default_branch: defaultBranch,
			},
		},
		repo: (obj: Record<string, unknown> = {}) => ({ owner, repo, ...obj }),
		log: { info: () => {}, warn: () => {} },
		octokit: {
			graphql: async (
				query: string,
				variables: Record<string, unknown>,
			): Promise<unknown> => ghGraphQL(query, variables, { token }),
			repos: {
				getReleaseByTag: (params: {
					owner: string;
					repo: string;
					tag: string;
				}) =>
					(
						octokit as unknown as {
							repos: {
								getReleaseByTag: (params: {
									owner: string;
									repo: string;
									tag: string;
								}) => Promise<{ data: unknown }>;
							};
						}
					).repos.getReleaseByTag(params),
				listReleases: octokit.repos.listReleases,
			},
			paginate: octokit.paginate,
		} as unknown as ReleaseDrafterContext["octokit"],
	};
	return ctx;
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

function buildContributors(
	pullRequestsSorted: PullRequest[] | null | undefined,
	excludeContributors: string[],
): Map<string, Author> {
	const contributorsMap = new Map<string, Author>();
	for (const pr of pullRequestsSorted || []) {
		const author = pr.author as Author | undefined;
		if (!author) continue;
		const login = author.login;
		if (!login) continue;
		// Apply exclude-contributors filter
		if (excludeContributors.includes(login)) continue;

		if (!contributorsMap.has(login)) {
			contributorsMap.set(login, { ...author });
		}
	}

	return contributorsMap;
}

// Detect if a given ref name is an existing tag in the repository.
// Returns the exact tag name if found, otherwise null.
async function detectExistingTag(params: {
	owner: string;
	repo: string;
	token: string;
	name?: string | null;
}): Promise<string | null> {
	const { owner, repo, token, name } = params;
	if (!name) return null;
	try {
		// Use matching-refs to avoid path-segment issues and check exact match
		const refs = (await ghRest(
			`/repos/${owner}/${repo}/git/matching-refs/tags/${encodeURIComponent(
				name,
			)}`,
			{ token },
		)) as Array<{ ref?: string } | string> | { ref?: string }[] | null;

		if (Array.isArray(refs)) {
			// Normalize to objects with ref field
			const hasExact = refs.some((r: unknown) => {
				let refStr = "";
				if (typeof r === "string") {
					refStr = r;
				} else if (r && typeof r === "object" && "ref" in r) {
					const obj = r as { ref?: string };
					refStr = String(obj.ref || "");
				}
				return refStr === `refs/tags/${name}`;
			});
			if (hasExact) {
				logVerbose(`[Releases] Detected existing tag: ${name}`);
				return name;
			}
		}
	} catch (e) {
		// Network errors or permission issues shouldn't break core behavior
		logVerbose(
			`[Releases] Tag detection skipped for ${name}: ${
				e instanceof Error ? e.message : String(e)
			}`,
		);
	}
	return null;
}

// Resolve a tag to the commit timestamp used as an upper bound for PR merging time.
// Follows annotated tags to the underlying commit and returns the commit's committer date.
async function resolveTagCommitDate(params: {
	owner: string;
	repo: string;
	token: string;
	tag: string;
}): Promise<string | null> {
	const { owner, repo, token, tag } = params;
	try {
		const ref = (await ghRest(`/repos/${owner}/${repo}/git/ref/tags/${tag}`, {
			token,
		})) as { object?: { sha?: string; type?: string } };
		let objSha = ref?.object?.sha || "";
		let objType = ref?.object?.type || "";

		// If annotated tag, dereference to underlying object
		let safety = 0;
		while (objType === "tag" && objSha && safety < 3) {
			safety++;
			const tagObj = (await ghRest(
				`/repos/${owner}/${repo}/git/tags/${objSha}`,
				{ token },
			)) as { object?: { sha?: string; type?: string } };
			objSha = tagObj?.object?.sha || objSha;
			objType = tagObj?.object?.type || objType;
			if (!objSha) break;
		}

		if (objSha && objType === "commit") {
			const commit = (await ghRest(
				`/repos/${owner}/${repo}/commits/${objSha}`,
				{ token },
			)) as {
				commit?: {
					committer?: { date?: string };
					author?: { date?: string };
				};
			};
			const date =
				commit?.commit?.committer?.date || commit?.commit?.author?.date;
			if (date) return date;
		}
	} catch (e) {
		logVerbose(
			`[Releases] Failed to resolve commit date for tag ${tag}: ${
				e instanceof Error ? e.message : String(e)
			}`,
		);
	}
	return null;
}

// Find the previous GitHub release relative to a given existing tag.
// If the tag has no corresponding release, optionally falls back to the latest
// release older than the tag's commit timestamp.
async function findPreviousReleaseForTag(params: {
	owner: string;
	repo: string;
	token: string;
	currentTag: string;
	includePreReleases: boolean;
	tagPrefix: string;
	tagUpperBoundDate?: string | null;
}): Promise<GitHubRelease | null> {
	const {
		owner,
		repo,
		token,
		currentTag,
		includePreReleases,
		tagPrefix,
		tagUpperBoundDate,
	} = params;

	// Try to locate the previous release in descending order, right after currentTag
	let page = 1;
	const perPage = 100;
	let foundCurrent = false;
	while (true) {
		const list = (await ghRest(
			`/repos/${owner}/${repo}/releases?per_page=${perPage}&page=${page}`,
			{ token },
		)) as GitHubRelease[];
		if (!Array.isArray(list) || list.length === 0) break;
		for (let i = 0; i < list.length; i++) {
			const r = list[i] as unknown as {
				tag_name?: string;
				prerelease?: boolean;
			};
			const tname = String(r.tag_name || "");
			if (!foundCurrent) {
				if (tname === currentTag) {
					foundCurrent = true;
				}
				continue;
			}
			if (!includePreReleases && r.prerelease) continue;
			if (tagPrefix && !tname.startsWith(tagPrefix)) continue;
			return list[i] as GitHubRelease;
		}
		page++;
	}

	// Fallback: choose the latest release older than the tag's commit time
	if (tagUpperBoundDate) {
		const until = new Date(tagUpperBoundDate).getTime();
		if (Number.isFinite(until)) {
			let page2 = 1;
			while (true) {
				const list = (await ghRest(
					`/repos/${owner}/${repo}/releases?per_page=100&page=${page2}`,
					{ token },
				)) as GitHubRelease[];
				if (!Array.isArray(list) || list.length === 0) break;
				for (const r of list as unknown as {
					tag_name?: string;
					prerelease?: boolean;
					created_at?: string;
					published_at?: string;
				}[]) {
					const tname = String(r.tag_name || "");
					if (!includePreReleases && r.prerelease) continue;
					if (tagPrefix && !tname.startsWith(tagPrefix)) continue;
					const created = new Date(
						String(r.published_at || r.created_at || 0),
					).getTime();
					if (created && created <= until) {
						return r as unknown as GitHubRelease;
					}
				}
				page2++;
			}
		}
	}

	return null;
}

// Resolve a tag to the commit timestamp used as an upper bound for PR merging time.
// Follows annotated tags to the underlying commit and returns the commit's committer date.
async function resolveTagCommitDate(params: {
	owner: string;
	repo: string;
	token: string;
	tag: string;
}): Promise<string | null> {
	const { owner, repo, token, tag } = params;
	try {
		// Get the ref for the exact tag
		const ref = (await ghRest(`/repos/${owner}/${repo}/git/ref/tags/${tag}`, {
			token,
		})) as { object?: { sha?: string; type?: string } };
		let objSha = ref?.object?.sha || "";
		let objType = ref?.object?.type || "";

		// If annotated tag, dereference to underlying object
		let safety = 0;
		while (objType === "tag" && objSha && safety < 3) {
			safety++;
			const tagObj = (await ghRest(
				`/repos/${owner}/${repo}/git/tags/${objSha}`,
				{ token },
			)) as {
				object?: { sha?: string; type?: string };
				tagger?: { date?: string };
			};
			objSha = tagObj?.object?.sha || objSha;
			objType = tagObj?.object?.type || objType;
			// If somehow no object, break
			if (!objSha) break;
		}

		// Expect commit type at this point
		if (objSha && objType === "commit") {
			const commit = (await ghRest(
				`/repos/${owner}/${repo}/commits/${objSha}`,
				{ token },
			)) as {
				commit?: {
					committer?: { date?: string };
					author?: { date?: string };
				};
			};
			const date =
				commit?.commit?.committer?.date || commit?.commit?.author?.date;
			if (date) return date;
		}
	} catch (e) {
		logVerbose(
			`[Releases] Failed to resolve commit date for tag ${tag}: ${
				e instanceof Error ? e.message : String(e)
			}`,
		);
	}
	return null;
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
	const repoInfo = (await ghRest(`/repos/${owner}/${repo}`, { token })) as {
		default_branch: string;
	};
	const defaultBranch: string = repoInfo.default_branch as string;
	logVerbose(`[GitHub] Default branch: ${defaultBranch}`);

	const context = buildContext({ owner, repo, token, defaultBranch });
	const rdConfig = validateSchema(context, cfg);

	let lastRelease: LastRelease = null;
	let rawReleaseData: GitHubRelease | null = null;

	// Determine if provided --target or --tag points to an existing tag.
	// If so, we should generate notes between that tag and the previous tag.
	const existingTagFromTarget = await detectExistingTag({
		owner,
		repo,
		token,
		name: target,
	});
	const existingTagFromTagArg = await detectExistingTag({
		owner,
		repo,
		token,
		name: tag,
	});
	const effectiveExistingTag = existingTagFromTarget || existingTagFromTagArg;

	// Resolve the commit date for the existing tag (upper bound for PRs and fallback)
	const tagUpperBoundDate = effectiveExistingTag
		? await resolveTagCommitDate({
				owner,
				repo,
				token,
				tag: effectiveExistingTag,
			})
		: null;

	if (prevTag) {
		logVerbose(`[Releases] Using explicit previous tag: ${prevTag}`);
		const rel = await context.octokit.repos.getReleaseByTag({
			owner,
			repo,
			tag: prevTag,
		});
		rawReleaseData = rel.data as GitHubRelease;
	} else if (effectiveExistingTag) {
		logVerbose(
			`[Releases] Resolving previous release relative to existing tag: ${effectiveExistingTag}`,
		);
		const includePreReleases = !!rdConfig["include-pre-releases"];
		const tagPrefix = String(rdConfig["tag-prefix"] || "");
		rawReleaseData = await findPreviousReleaseForTag({
			owner,
			repo,
			token,
			currentTag: effectiveExistingTag,
			includePreReleases,
			tagPrefix,
			tagUpperBoundDate,
		});
		if (rawReleaseData) {
			logVerbose(
				`[Releases] Previous release detected for ${effectiveExistingTag}: ${String(
					rawReleaseData.tag_name,
				)}`,
			);
		} else {
			logVerbose(
				`[Releases] No previous release found for ${effectiveExistingTag}; using beginning of history`,
			);
		}
	} else {
		logVerbose(
			`[Releases] Auto-detecting previous release (target=${
				target || defaultBranch
			})`,
		);
		// TODO: Support --no-auto-prev flag to disable automatic previous release detection
		// When autoPrev is false, should generate changelog from the beginning of commit history
		// (matching GitHub's "Generate release notes" behavior when no previous tag exists)
		// This would require passing autoPrev from CLI and conditionally skipping findReleases
		const { draftRelease: _draftRelease, lastRelease: lr } = await findReleases(
			{
				context,
				targetCommitish: target || defaultBranch,
				filterByCommitish: !!rdConfig["filter-by-commitish"],
				includePreReleases: !!rdConfig["include-pre-releases"],
				tagPrefix: String(rdConfig["tag-prefix"] || ""),
			},
		);
		rawReleaseData = lr as GitHubRelease | null;
	}

	// Map the raw release data to our LastRelease type
	if (rawReleaseData) {
		lastRelease = {
			id: rawReleaseData.id,
			tag_name: rawReleaseData.tag_name,
			created_at: rawReleaseData.created_at,
			published_at: rawReleaseData.published_at || undefined,
			name: rawReleaseData.name || undefined,
			prerelease: rawReleaseData.prerelease || undefined,
		};

		if (lastRelease?.tag_name) {
			logVerbose(`[Releases] Using release: ${lastRelease.tag_name}`);
		}
	} else {
		logVerbose("[Releases] No previous release found, starting from beginning");
	}

	// Generate full changelog link
	const previousTag = prevTag || lastRelease?.tag_name;
	const nextTagForLink = effectiveExistingTag
		? effectiveExistingTag
		: preview
			? target || tag || defaultBranch
			: tag || target || defaultBranch;

	const fullChangelogLink = generateFullChangelogLink({
		owner,
		repo,
		previousTag,
		nextTag: nextTagForLink,
	});

	// Replace $FULL_CHANGELOG_LINK placeholder in template if it exists
	if (
		(rdConfig as { template?: string }).template &&
		(rdConfig as { template: string }).template.includes("$FULL_CHANGELOG_LINK")
	) {
		logVerbose(
			`[Template] Injecting FULL_CHANGELOG_LINK: ${fullChangelogLink}`,
		);
		(rdConfig as { template: string }).template = (
			rdConfig as { template: string }
		).template.replaceAll("$FULL_CHANGELOG_LINK", fullChangelogLink);
	}

	const targetCommitish: string =
		effectiveExistingTag || target || defaultBranch;
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
	const includeLabels: string[] = Array.isArray(rdConfig["include-labels"])
		? rdConfig["include-labels"]
		: [];
	const excludeLabels: string[] = Array.isArray(rdConfig["exclude-labels"])
		? rdConfig["exclude-labels"]
		: [];

	// If an existing tag is specified for target/tag, resolve its commit date
	// to use as an upper bound for PR merge time.
	const untilDate = tagUpperBoundDate || undefined;

	let pullRequests = await fetchMergedPRs({
		owner,
		repo,
		sinceDate,
		untilDate: untilDate || undefined,
		baseBranch: baseBranchName,
		graphqlFn: context.octokit.graphql as (
			query: string,
			variables?: Record<string, unknown>,
		) => Promise<unknown>,
		withBody: needBody,
		withBaseRefName: needBase,
		withHeadRefName: needHead,
		sponsorFetchMode,
		includeLabels,
		excludeLabels,
	});

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
			pullRequests,
			includePaths,
			graphqlFn: context.octokit.graphql as (
				query: string,
				variables?: {
					owner: string;
					name: string;
					[key: string]: string | null;
				},
			) => Promise<{
				repo?: {
					[key: string]: {
						files?: {
							pageInfo: { hasNextPage: boolean; endCursor: string | null };
							nodes: Array<{ path: string; previousFilePath?: string | null }>;
						};
					};
				};
			}>,
		});
	}
	logVerbose(`[GitHub] Collected ${pullRequests.length} merged PRs`);

	// Start sponsor enrichment in parallel (don't await yet)
	let sponsorEnrichmentPromise: Promise<PullRequest[]> | null = null;
	if (sponsorFetchMode === "html" && pullRequests.length > 0) {
		logVerbose(`[GitHub] Starting HTML sponsor enrichment in background`);
		sponsorEnrichmentPromise = enrichWithHtmlSponsorData(pullRequests, 10);
	}

	// Align PR order with release-drafter by applying its exported sorter
	// Keep nodes structure for release-drafter compatibility
	// Note: Type casting through unknown is necessary due to structural differences
	// between our PullRequest type and release-drafter's MergedPullRequest type
	const pullRequestsSorted: PullRequest[] = Array.isArray(pullRequests)
		? (sortPullRequests(
				pullRequests as unknown as MergedPullRequest[],
				rdConfig["sort-by"],
				rdConfig["sort-direction"],
			) as unknown as PullRequest[])
		: pullRequests;

	logVerbose("[Release] Generating release info from commits/PRs...");
	const releaseInfo = generateReleaseInfo({
		context,
		commits: [],
		config: rdConfig,
		lastRelease,
		mergedPullRequests: pullRequestsSorted as unknown as MergedPullRequest[],
		tag,
		isPreRelease: rdConfig.prerelease,
		latest: rdConfig.latest,
		shouldDraft: true,
		targetCommitish,
	});
	logVerbose(
		`[Release] Generated release: name=${String(releaseInfo.name || "")} tag=${String(
			releaseInfo.tag || tag || "",
		)}`,
	);

	// Build contributors list from PRs first (with exclude-contributors applied)
	const excludeContributors: string[] = Array.isArray(
		rdConfig["exclude-contributors"],
	)
		? rdConfig["exclude-contributors"]
		: [];

	let contributorsMap = buildContributors(
		pullRequestsSorted,
		excludeContributors,
	);
	let contributors = Array.from(contributorsMap.values());

	// Check for $NEW_CONTRIBUTORS placeholder in template
	let newContributorsSection = "";
	let newContributorsData = null;
	let newContributorsPromise: Promise<unknown> | null = null;

	const shouldFetchNewContributors =
		!options.skipNewContributors &&
		(includeAllData ||
			(rdConfig.template &&
				(rdConfig.template as string).includes("$NEW_CONTRIBUTORS")));

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
				contributors,
				filteredPullRequests: pullRequests,
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

		// Wait for new contributors detection if it was started
		if (newContributorsPromise) {
			const newContributorsResult = (await newContributorsPromise) as {
				newContributors: NewContributor[];
			};
			newContributorsSection = formatNewContributorsSection(
				newContributorsResult.newContributors,
			);
			newContributorsData = newContributorsResult;
			logVerbose("[Parallel] New contributors detection completed");
		}

		// Wait for sponsor enrichment if it was started
		if (sponsorEnrichmentPromise) {
			const enrichedPullRequests = await sponsorEnrichmentPromise;
			if (enrichedPullRequests) {
				// Update both the base and sorted versions
				pullRequests = enrichedPullRequests;
				// Re-sort with enriched data (keep nodes structure)
				const sortedEnriched = sortPullRequests(
					enrichedPullRequests as unknown as MergedPullRequest[],
					rdConfig["sort-by"],
					rdConfig["sort-direction"],
				) as unknown as PullRequest[];
				pullRequestsSorted.length = 0;
				pullRequestsSorted.push(...sortedEnriched);

				// Rebuild contributors with enriched author data (simple reassignment)
				contributorsMap = buildContributors(
					enrichedPullRequests,
					excludeContributors,
				);
				contributors = Array.from(contributorsMap.values());
				logVerbose("[Parallel] Sponsor enrichment completed");
			}
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

	// Map new contributors back to include full author data
	const newContributorsOutput = newContributorsData
		? (
				newContributorsData as {
					newContributors: Array<{
						login: string;
						firstPullRequest: {
							number: number;
							title: string;
							url: string;
							mergedAt: string;
						};
					}>;
				}
			).newContributors.map((c) => {
				const base = contributorsMap.get(c.login);
				return {
					...base,
					firstPullRequest: c.firstPullRequest,
				} as NewContributor;
			})
		: null;

	// Build categorized pull requests for JSON output using local workaround
	// categorizePullRequests expects PullRequest[] with nodes structure
	const categorizedPullRequests = categorizePullRequests(
		pullRequestsSorted || [],
		rdConfig as CategorizeConfig,
	);

	// The categorized result already has the right structure
	const flattenedCategorized: CategorizedPullRequests = {
		uncategorized: categorizedPullRequests.uncategorized.map((pr) => ({
			...pr,
			labels:
				pr.labels?.nodes?.map((node: { name: string }) => node.name) || [],
		})),
		categories: categorizedPullRequests.categories.map((cat) => ({
			...cat,
			pullRequests: cat.pullRequests.map((pr) => ({
				...pr,
				labels:
					pr.labels?.nodes?.map((node: { name: string }) => node.name) || [],
			})),
		})),
	};

	// Create the output data structure once
	const result: RunResult = {
		owner,
		repo,
		defaultBranch,
		lastRelease,
		mergedPullRequests: pullRequestsSorted.map((pr) => ({
			...pr,
			labels: pr.labels?.nodes?.map((node) => node.name) || [],
		})),
		categorizedPullRequests: flattenedCategorized,
		contributors,
		newContributors: newContributorsOutput,
		release: {
			name: releaseInfo.name,
			tag: releaseInfo.tag,
			body: releaseInfo.body,
			targetCommitish: releaseInfo.targetCommitish,
			resolvedVersion: String(releaseInfo.resolvedVersion),
			majorVersion: Number(releaseInfo.majorVersion),
			minorVersion: Number(releaseInfo.minorVersion),
			patchVersion: Number(releaseInfo.patchVersion),
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
