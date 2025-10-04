import { exec } from "child_process";
import { promisify } from "util";

const execAsync = promisify(exec);

export interface Repo {
	owner: string;
	name: string;
	host: string;
}

export interface ResolveOptions {
	flagRepo?: string;
	defaultHost?: string;
}

export async function resolveBaseRepo(opts: ResolveOptions): Promise<Repo> {
	const defaultHost = opts.defaultHost || "github.com";

	// Priority 1: --repo flag
	if (opts.flagRepo) {
		const r = parseRepoRef(opts.flagRepo, defaultHost);
		if (!r) throw new Error(`Invalid --repo value: ${opts.flagRepo}`);
		return r;
	}

	// Priority 2: GITHUB_REPOSITORY (GitHub Actions environment variable)
	if (process.env.GITHUB_REPOSITORY) {
		const r = parseRepoRef(process.env.GITHUB_REPOSITORY, defaultHost);
		if (!r)
			throw new Error(
				`Invalid GITHUB_REPOSITORY value: ${process.env.GITHUB_REPOSITORY}`,
			);
		return r;
	}

	// Priority 3: GH_REPO environment variable
	if (process.env.GH_REPO) {
		const r = parseRepoRef(process.env.GH_REPO, defaultHost);
		if (!r) throw new Error(`Invalid GH_REPO value: ${process.env.GH_REPO}`);
		return r;
	}

	// Priority 4: Git remotes
	const remotes = await readGitRemotes();
	if (remotes.length === 0) {
		throw new Error(
			"No git remotes found. Please run this command in a git repository.",
		);
	}

	// Collect normalized repo candidates from fetch/push URLs
	const repos: Array<{ name: string; repo: Repo }> = [];
	for (const r of remotes) {
		for (const url of [r.fetch, r.push]) {
			if (!url) continue;
			const parsed = normalizeGitURL(url);
			if (parsed) repos.push({ name: r.name, repo: parsed });
		}
	}

	if (repos.length === 0) {
		throw new Error(
			"No valid git remotes found. Please check your git remote configuration.",
		);
	}

	// Filter by hosts if gh CLI is available
	const authedHosts = await getAuthedHosts();
	let filtered = repos;

	// If we have authenticated hosts from gh CLI, use them for filtering
	if (authedHosts.length > 0) {
		const ghHost = process.env.GH_HOST;
		const byAuth = repos.filter((x) =>
			authedHosts.some((h) => x.repo.host.toLowerCase() === h.toLowerCase()),
		);

		if (byAuth.length > 0) {
			filtered = ghHost
				? byAuth.filter((x) => x.repo.host.toLowerCase() === ghHost.toLowerCase())
				: byAuth;

			if (ghHost && filtered.length === 0) {
				throw new Error(
					`No remotes match GH_HOST=${ghHost}. Add a matching remote or unset GH_HOST.`,
				);
			}
		}
		// If no authenticated hosts match, continue with all repos (fallback)
	} else {
		// No gh CLI available, filter by GH_HOST if set
		const ghHost = process.env.GH_HOST;
		if (ghHost) {
			filtered = repos.filter(
				(x) => x.repo.host.toLowerCase() === ghHost.toLowerCase(),
			);
			if (filtered.length === 0) {
				throw new Error(
					`No remotes match GH_HOST=${ghHost}. Add a matching remote or unset GH_HOST.`,
				);
			}
		}
	}

	// Sort by remote name preference and deduplicate
	const uniqueRepos = new Map<string, { name: string; repo: Repo }>();
	for (const item of filtered) {
		const key = `${item.repo.host}/${item.repo.owner}/${item.repo.name}`;
		const existing = uniqueRepos.get(key);
		if (!existing || remoteScore(item.name) > remoteScore(existing.name)) {
			uniqueRepos.set(key, item);
		}
	}

	const scored = Array.from(uniqueRepos.values())
		.map((x) => ({ score: remoteScore(x.name), repo: x.repo }))
		.sort((a, b) => b.score - a.score);

	if (scored.length === 0) {
		throw new Error("No valid git remotes found after filtering.");
	}

	return scored[0].repo;
}

export function parseRepoRef(input: string, defaultHost: string): Repo | null {
	if (!input) return null;

	// Handle full URLs (HTTPS)
	if (input.startsWith("https://") || input.startsWith("http://")) {
		const match = input.match(
			/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+)(\.git)?$/,
		);
		if (match) {
			return {
				host: normalizeHost(match[1]),
				owner: match[2],
				name: match[3],
			};
		}
		return null;
	}

	// Handle SSH URLs
	if (input.startsWith("git@") || input.includes(":")) {
		const match = input.match(/^git@([^:]+):([^/]+)\/([^/.]+)(\.git)?$/);
		if (match) {
			return {
				host: normalizeHost(match[1]),
				owner: match[2],
				name: match[3],
			};
		}
	}

	// Handle HOST/OWNER/REPO format
	const parts = input.split("/");
	if (parts.length === 3) {
		return {
			host: normalizeHost(parts[0]),
			owner: parts[1],
			name: parts[2].replace(/\.git$/, ""),
		};
	}

	// Handle OWNER/REPO format
	if (parts.length === 2) {
		return {
			host: defaultHost,
			owner: parts[0],
			name: parts[1].replace(/\.git$/, ""),
		};
	}

	return null;
}

export async function readGitRemotes(): Promise<
	Array<{ name: string; fetch?: string; push?: string }>
> {
	try {
		const { stdout } = await execAsync("git remote -v");
		const lines = stdout.trim().split("\n").filter(Boolean);

		const remoteMap = new Map<string, { fetch?: string; push?: string }>();

		for (const line of lines) {
			const match = line.match(/^(\S+)\s+(\S+)\s+\((fetch|push)\)$/);
			if (!match) continue;

			const [, name, url, type] = match;
			const existing = remoteMap.get(name) || {};

			if (type === "fetch") {
				existing.fetch = url;
			} else if (type === "push") {
				existing.push = url;
			}

			remoteMap.set(name, existing);
		}

		return Array.from(remoteMap.entries()).map(([name, urls]) => ({
			name,
			...urls,
		}));
	} catch {
		// If git command fails, return empty array
		return [];
	}
}

export function normalizeGitURL(url: string): Repo | null {
	// HTTPS URL
	if (url.startsWith("https://") || url.startsWith("http://")) {
		const match = url.match(/^https?:\/\/([^/]+)\/([^/]+)\/([^/.]+)(\.git)?$/);
		if (match) {
			return {
				host: normalizeHost(match[1]),
				owner: match[2],
				name: match[3],
			};
		}
	}

	// SSH URL (git@host:owner/repo.git)
	if (url.startsWith("git@") || url.includes(":")) {
		const match = url.match(/^git@([^:]+):([^/]+)\/([^/.]+)(\.git)?$/);
		if (match) {
			return {
				host: normalizeHost(match[1]),
				owner: match[2],
				name: match[3],
			};
		}
	}

	// SSH URL with ssh:// prefix
	if (url.startsWith("ssh://")) {
		const match = url.match(/^ssh:\/\/git@([^/]+)\/([^/]+)\/([^/.]+)(\.git)?$/);
		if (match) {
			return {
				host: normalizeHost(match[1]),
				owner: match[2],
				name: match[3],
			};
		}
	}

	return null;
}

function normalizeHost(host: string): string {
	// Remove www. prefix
	let normalized = host.replace(/^www\./, "");
	// Convert to lowercase
	normalized = normalized.toLowerCase();
	// Remove port if present
	normalized = normalized.replace(/:\d+$/, "");
	return normalized;
}

export async function getAuthedHosts(): Promise<string[]> {
	try {
		// Check if gh CLI is available
		const { stdout: versionStdout } = await execAsync(
			"gh --version 2>/dev/null || true",
		);

		if (!versionStdout.includes("gh version")) {
			// gh CLI is not installed
			return [];
		}

		// Try to get authenticated hosts from gh CLI
		const { stdout } = await execAsync(
			"gh auth status --show-hosts 2>/dev/null || true",
		);
		const hosts = stdout
			.trim()
			.split("\n")
			.filter(Boolean)
			.map((line) => line.trim())
			.filter((line) => !line.startsWith("✓") && !line.includes("Logged in"));

		// If no hosts from gh auth status, try to parse the output differently
		if (hosts.length === 0) {
			// Try alternative command
			const { stdout: configStdout } = await execAsync(
				"gh config list 2>/dev/null || true",
			);
			const hostMatches = configStdout.match(/hosts\.([^:]+)/g);
			if (hostMatches) {
				return hostMatches.map((m) => m.replace("hosts.", ""));
			}

			// Default to github.com if gh is installed but no explicit hosts
			return ["github.com"];
		}

		return hosts.filter(Boolean);
	} catch {
		// If gh CLI is not installed or fails, return empty array
		return [];
	}
}

export function remoteScore(name: string): number {
	switch (name.toLowerCase()) {
		case "upstream":
			return 3;
		case "github":
			return 2;
		case "origin":
			return 1;
		default:
			return 0;
	}
}
