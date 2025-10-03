import { createRequire } from "node:module";
import fs from "node:fs";
import path from "node:path";
import { Octokit } from "@octokit/rest";
import yaml from "js-yaml";
const require = createRequire(__filename);
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

const DEFAULT_FALLBACK_TEMPLATE = "## What's Changed\n\n$CHANGES";

export type RunOptions = {
	repo: string;
	config?: string;
	prevTag?: string;
	tag?: string;
	target?: string;
	token?: string;
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

export async function run(options: RunOptions) {
	const { repo: repoNameWithOwner, config, prevTag, tag, target } = options;
	const token =
		options.token || process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	if (!repoNameWithOwner) throw new Error("Missing repo (owner/repo)");
	if (!token) throw new Error("Missing GITHUB_TOKEN or GH_TOKEN");
	const [owner, repo] = repoNameWithOwner.split("/");
	if (!owner || !repo) throw new Error("Invalid repo, expected owner/repo");

	// Load config (optional). If not provided, try local .github/release-drafter.yml then fallback.
	let cfg: any;
	if (config) {
		const rawCfg = fs.readFileSync(path.resolve(process.cwd(), config), "utf8");
		cfg = parseConfigString(rawCfg, config);
	} else {
		const localCfgPath = path.resolve(
			process.cwd(),
			".github/release-drafter.yml",
		);
		if (fs.existsSync(localCfgPath)) {
			const raw = fs.readFileSync(localCfgPath, "utf8");
			cfg = parseConfigString(raw, localCfgPath);
		} else {
			cfg = { template: DEFAULT_FALLBACK_TEMPLATE };
		}
	}

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
