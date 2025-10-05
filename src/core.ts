import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";
import { normalizeConfig } from "./github-config-converter";
import { DEFAULT_FALLBACK_CONFIG } from "./constants";
import { ConfigLoaderFactory } from "./config-loader";
import {
	findNewContributors,
	formatNewContributorsSection,
} from "./new-contributors";
import { logVerbose } from "./logger";
import {
	buildMinimalContributors,
	enrichContributorAvatars,
} from "./contributors";
const {
	validateSchema,
}: { validateSchema: any } = require("release-drafter/lib/schema");
const {
	findCommitsWithAssociatedPullRequests,
}: {
	findCommitsWithAssociatedPullRequests: any;
} = require("release-drafter/lib/commits");
const {
	generateReleaseInfo,
	findReleases,
}: {
	generateReleaseInfo: any;
	findReleases: any;
} = require("release-drafter/lib/releases");

export type RunOptions = {
	repo: string;
	config?: string;
	prevTag?: string;
	tag?: string;
	target?: string;
	token?: string;
	preview?: boolean;
	includeNewContributors?: boolean;
};

async function ghRest(
	pathname: string,
	{
		token,
		method = "GET" as const,
	}: { token: string; method?: "GET" | "POST" },
): Promise<any> {
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
	return res.json() as Promise<any>;
}

async function ghGraphQL(
	query: string,
	variables: any,
	{ token }: { token: string },
): Promise<any> {
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
	const payload: any = await res.json();
	if (payload.errors) {
		throw new Error(`GitHub GraphQL errors: ${JSON.stringify(payload.errors)}`);
	}
	return payload.data as any;
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
		repo: (obj: Record<string, any> = {}) => ({ owner, repo, ...obj }),
		log: { info: () => {}, warn: () => {} },
		octokit: octokit as any,
	};
	// Provide graphql compatible with release-drafter's expectation
	ctx.octokit.graphql = async (query: string, variables: any): Promise<any> =>
		ghGraphQL(query, variables, { token });
	return ctx as any;
}

function parseConfigString(source: string, filename = ""): any {
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

export async function run(options: RunOptions) {
	const {
		repo: repoNameWithOwner,
		config,
		prevTag,
		tag,
		target,
		preview,
	} = options;
	logVerbose("[Run] Resolving GitHub token...");
	const token = await getGitHubToken(options.token);
	logVerbose("[Run] GitHub token resolved");
	if (!repoNameWithOwner) throw new Error("Missing repo (owner/repo)");
	const [owner, repo] = repoNameWithOwner.split("/");
	if (!owner || !repo) throw new Error("Invalid repo, expected owner/repo");

	// Load config (optional). If not provided, try local configs then fallback.
	let cfg: any;
	if (config) {
		logVerbose(`[Config] Loading config from: ${config}`);
		// Use config loader for remote config support
		const configLoader = new ConfigLoaderFactory(token);
		const rawCfg = await configLoader.load(config);
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

	logVerbose(`[GitHub] Fetching repository info for ${owner}/${repo}`);
	const repoInfo: any = await ghRest(`/repos/${owner}/${repo}`, { token });
	const defaultBranch: string = repoInfo.default_branch as string;
	logVerbose(`[GitHub] Default branch: ${defaultBranch}`);

	const context: any = buildContext({ owner, repo, token, defaultBranch });
	const rdConfig: any = validateSchema(context, cfg);

	let lastRelease: any = null;
	if (prevTag) {
		logVerbose(`[Releases] Using explicit previous tag: ${prevTag}`);
		const rel: any = await context.octokit.repos.getReleaseByTag({
			owner,
			repo,
			tag: prevTag,
		});
		lastRelease = rel.data;
	} else {
		logVerbose(
			`[Releases] Auto-detecting previous release (target=${target || defaultBranch})`,
		);
		// TODO: Support --no-auto-prev flag to disable automatic previous release detection
		// When autoPrev is false, should generate changelog from the beginning of commit history
		// (matching GitHub's "Generate release notes" behavior when no previous tag exists)
		// This would require passing autoPrev from CLI and conditionally skipping findReleases
		const { draftRelease: _draftRelease, lastRelease: lr }: any =
			await findReleases({
				context,
				targetCommitish: target || defaultBranch,
				filterByCommitish: !!rdConfig["filter-by-commitish"],
				includePreReleases: !!rdConfig["include-pre-releases"],
				tagPrefix: String(rdConfig["tag-prefix"] || ""),
			});
		lastRelease = lr || null;
		if (lastRelease?.tag_name) {
			logVerbose(`[Releases] Detected last release: ${lastRelease.tag_name}`);
		} else {
			logVerbose("[Releases] No previous release detected");
		}
	}

	// Replace $FULL_CHANGELOG_LINK placeholder in template before processing
	if (rdConfig.template && rdConfig.template.includes("$FULL_CHANGELOG_LINK")) {
		const previousTag = prevTag || lastRelease?.tag_name;
		const fullChangelogLink = generateFullChangelogLink({
			owner,
			repo,
			previousTag,
			nextTag: preview
				? target || tag || defaultBranch
				: tag || target || defaultBranch,
		});
		logVerbose(
			`[Template] Injecting FULL_CHANGELOG_LINK: ${fullChangelogLink}`,
		);
		rdConfig.template = rdConfig.template.replaceAll(
			"$FULL_CHANGELOG_LINK",
			fullChangelogLink,
		);
	}

	const targetCommitish: string = target || defaultBranch;
	logVerbose("[GitHub] Resolving commits and associated pull requests...");
	const data: any = await findCommitsWithAssociatedPullRequests({
		context,
		targetCommitish,
		lastRelease,
		config: rdConfig,
	});
	logVerbose(
		`[GitHub] Found ${data.pullRequests?.length ?? 0} PRs and ${data.commits?.length ?? 0} commits`,
	);

	logVerbose("[Release] Generating release info from commits/PRs...");
	const releaseInfo: any = generateReleaseInfo({
		context,
		commits: data.commits,
		config: rdConfig,
		lastRelease,
		mergedPullRequests: data.pullRequests,
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

	// Check for $NEW_CONTRIBUTORS placeholder in template
	let newContributorsSection = "";
	let newContributorsData = null;
	if (
		rdConfig.template &&
		(rdConfig.template.includes("$NEW_CONTRIBUTORS") ||
			options.includeNewContributors)
	) {
		// Get the date of the previous release if available
		const prevReleaseDate =
			lastRelease?.published_at || lastRelease?.created_at;

		// Skip new contributors detection if no previous release exists
		// Without a baseline, all contributors would be marked as "new"
		if (prevReleaseDate) {
			logVerbose("[New Contributors] Detecting new contributors...");
			const newContributorsResult = await findNewContributors({
				owner,
				repo,
				pullRequests: data.pullRequests,
				token,
				prevReleaseDate,
			});
			newContributorsSection = formatNewContributorsSection(
				newContributorsResult.newContributors,
			);
			newContributorsData = newContributorsResult;
		} else {
			logVerbose(
				"[New Contributors] Skipping detection - no previous release tag found",
			);
		}

		// Replace $NEW_CONTRIBUTORS placeholder in the release body
		if (releaseInfo.body && rdConfig.template?.includes("$NEW_CONTRIBUTORS")) {
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
	}

	// Build and enrich minimal contributors (like release-drafter's $CONTRIBUTORS)
	const minimalContributors = buildMinimalContributors(
		data.pullRequests,
		Array.isArray(rdConfig["exclude-contributors"])
			? rdConfig["exclude-contributors"]
			: [],
	);
	const contributors = await enrichContributorAvatars(
		minimalContributors,
		(pathname) => ghRest(pathname, { token }),
	);

	// Transform new contributors data for JSON output (remove internal details)
	const newContributorsOutput = newContributorsData
		? {
				newContributors: newContributorsData.newContributors.map((c) => ({
					login: c.login,
					isBot: c.isBot,
					firstPullRequest: c.firstPullRequest,
				})),
				totalContributors: newContributorsData.totalContributors,
			}
		: null;

	logVerbose("[Run] Completed successfully");
	return {
		release: releaseInfo,
		commits: data.commits,
		pullRequests: data.pullRequests,
		contributors,
		newContributors: newContributorsOutput,
		lastRelease: lastRelease
			? {
					id: lastRelease.id,
					tag_name: lastRelease.tag_name,
					created_at: lastRelease.created_at,
				}
			: null,
		defaultBranch,
		targetCommitish,
		owner,
		repo,
	};
}
