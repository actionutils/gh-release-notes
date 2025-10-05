import type { ConfigLoader } from "./types";
import { parsePurl, parseChecksumQualifier, validateChecksums } from "./utils";
import { logVerbose } from "../logger";

export class PurlGitHubConfigLoader implements ConfigLoader {
	private token: string;

	constructor(token: string) {
		this.token = token;
	}

	async load(source: string): Promise<string> {
		logVerbose(`[ConfigLoader:purl] Parsing purl: ${source}`);
		const purl = parsePurl(source);

		// Validate it's a GitHub purl
		if (purl.type !== "github") {
			throw new Error(
				`Unsupported purl type: ${purl.type}. Only 'github' is supported`,
			);
		}

		// Validate subpath is provided
		if (!purl.subpath) {
			throw new Error(
				"purl must include a subpath (e.g., #path/to/config.yaml)",
			);
		}

		// Build the repository path
		const repoPath = purl.namespace
			? `${purl.namespace}/${purl.name}`
			: purl.name;

		// Get the ref (version or default branch)
		const ref = purl.version || (await this.getDefaultBranch(repoPath));
		logVerbose(
			`[ConfigLoader:purl] Repo=${repoPath} Ref=${ref} Path=${purl.subpath}`,
		);

		// Fetch the file content
		const content = await this.fetchFileContent(repoPath, ref, purl.subpath);

		// Validate checksum if provided
		if (purl.qualifiers?.checksum) {
			logVerbose(
				`[ConfigLoader:purl] Validating checksums: ${purl.qualifiers.checksum}`,
			);
			const checksums = parseChecksumQualifier(purl.qualifiers.checksum);
			await validateChecksums(content, checksums);
		}

		return content;
	}

	private async getDefaultBranch(repo: string): Promise<string> {
		logVerbose(`[ConfigLoader:purl] Resolving default branch for ${repo}`);
		const response = await fetch(`https://api.github.com/repos/${repo}`, {
			headers: {
				Authorization: `Bearer ${this.token}`,
				"User-Agent": "gh-release-notes",
				Accept: "application/vnd.github+json",
			},
		});

		if (!response.ok) {
			throw new Error(
				`Failed to fetch repository info: HTTP ${response.status} ${response.statusText}`,
			);
		}

		const data = (await response.json()) as { default_branch: string };
		return data.default_branch;
	}

	private async fetchFileContent(
		repo: string,
		ref: string,
		path: string,
	): Promise<string> {
		// Use GitHub Contents API
		const url = `https://api.github.com/repos/${repo}/contents/${path}?ref=${ref}`;
		logVerbose(`[ConfigLoader:purl] Fetching content: ${url}`);
		const response = await fetch(url, {
			headers: {
				Authorization: `Bearer ${this.token}`,
				"User-Agent": "gh-release-notes",
				Accept: "application/vnd.github.v3.raw",
			},
		});

		if (!response.ok) {
			if (response.status === 404) {
				throw new Error(
					`File not found: ${path} in ${repo}@${ref}. Check the path and permissions.`,
				);
			}
			throw new Error(
				`Failed to fetch file: HTTP ${response.status} ${response.statusText}`,
			);
		}

		const content = await response.text();
		logVerbose(
			`[ConfigLoader:purl] Retrieved ${content.length} bytes from contents API`,
		);

		// Check for reasonable size limit (1MB)
		if (content.length > 1024 * 1024) {
			throw new Error("Config file too large (max 1MB)");
		}

		return content;
	}
}
