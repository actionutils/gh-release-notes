import fs from "node:fs";
import path from "node:path";
import { execSync } from "node:child_process";
import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";
import { normalizeConfig } from "./github-config-converter";
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

const DEFAULT_FALLBACK_TEMPLATE =
	"## What's Changed\n\n$CHANGES\n\n$FULL_CHANGELOG";

export type RunOptions = {
	repo: string;
	config?: string;
	prevTag?: string;
	tag?: string;
	target?: string;
	token?: string;
	preview?: boolean;
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
			return yaml.load(source);
		} catch (error) {
			throw new Error(
				"Failed to parse YAML config: " + (error as Error).message,
			);
		}
	}
	try {
		return JSON.parse(source);
	} catch (error) {
		throw new Error(
			"Config is neither valid JSON nor YAML: " + (error as Error).message,
		);
	}
}

async function getGitHubToken(providedToken?: string): Promise<string> {
	// First try provided token
	if (providedToken) return providedToken;

	// Then try environment variables
	if (process.env.GITHUB_TOKEN) return process.env.GITHUB_TOKEN;
	if (process.env.GH_TOKEN) return process.env.GH_TOKEN;

	// Finally try gh auth token
	try {
		const token = execSync("gh auth token", { encoding: "utf8" }).trim();
		if (token) return token;
	} catch (error) {
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
		return `**Full Changelog**: https://github.com/${owner}/${repo}/compare/${previousTag}...${nextTag}`;
	}
	return `**Full Changelog**: https://github.com/${owner}/${repo}/commits/${nextTag}`;
}

function replaceFullChangelogPlaceholder(
	body: string,
	params: {
		owner: string;
		repo: string;
		prevTag?: string;
		lastReleaseTag?: string;
		tag?: string;
		target?: string;
		defaultBranch: string;
		preview?: boolean;
	},
): string {
	if (!body.includes("$FULL_CHANGELOG")) {
		return body;
	}

	const {
		owner,
		repo,
		prevTag,
		lastReleaseTag,
		tag,
		target,
		defaultBranch,
		preview,
	} = params;

	// Determine the previous and next tags for comparison
	const previousTag = prevTag || lastReleaseTag;
	const nextTag = preview
		? (target || tag || defaultBranch)
		: (tag || target || defaultBranch);

	// Generate the link
	const fullChangelogLink = generateFullChangelogLink({
		owner,
		repo,
		previousTag,
		nextTag,
	});

	// Replace all occurrences (template might have multiple)
	return body.replaceAll("$FULL_CHANGELOG", fullChangelogLink);
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
	const token = await getGitHubToken(options.token);
	if (!repoNameWithOwner) throw new Error("Missing repo (owner/repo)");
	const [owner, repo] = repoNameWithOwner.split("/");
	if (!owner || !repo) throw new Error("Invalid repo, expected owner/repo");

	// Load config (optional). If not provided, try local configs then fallback.
	let cfg: any;
	if (config) {
		const rawCfg = fs.readFileSync(path.resolve(process.cwd(), config), "utf8");
		cfg = parseConfigString(rawCfg, config);
	} else {
		// Try release-drafter.yml first
		const releaseDrafterPath = path.resolve(
			process.cwd(),
			".github/release-drafter.yml",
		);
		// Then try GitHub's release.yml
		const githubReleasePath = path.resolve(
			process.cwd(),
			".github/release.yml",
		);

		if (fs.existsSync(releaseDrafterPath)) {
			const raw = fs.readFileSync(releaseDrafterPath, "utf8");
			cfg = parseConfigString(raw, releaseDrafterPath);
		} else if (fs.existsSync(githubReleasePath)) {
			const raw = fs.readFileSync(githubReleasePath, "utf8");
			cfg = parseConfigString(raw, githubReleasePath);
		} else {
			cfg = { template: DEFAULT_FALLBACK_TEMPLATE };
		}
	}

	// Convert GitHub format to release-drafter format if needed
	cfg = normalizeConfig(cfg);

	const repoInfo: any = await ghRest(`/repos/${owner}/${repo}`, { token });
	const defaultBranch: string = repoInfo.default_branch as string;

	const context: any = buildContext({ owner, repo, token, defaultBranch });
	const rdConfig: any = validateSchema(context, cfg);

	let lastRelease: any = null;
	if (prevTag) {
		const rel: any = await context.octokit.repos.getReleaseByTag({
			owner,
			repo,
			tag: prevTag,
		});
		lastRelease = rel.data;
	} else {
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
	}

	const targetCommitish: string = target || defaultBranch;
	const data: any = await findCommitsWithAssociatedPullRequests({
		context,
		targetCommitish,
		lastRelease,
		config: rdConfig,
	});

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

	// Replace $FULL_CHANGELOG placeholder if present in the template
	if (releaseInfo.body) {
		releaseInfo.body = replaceFullChangelogPlaceholder(releaseInfo.body, {
			owner,
			repo,
			prevTag,
			lastReleaseTag: lastRelease?.tag_name,
			tag,
			target: target || targetCommitish,
			defaultBranch,
			preview,
		});
	}

	return {
		release: releaseInfo,
		commits: data.commits,
		pullRequests: data.pullRequests,
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
