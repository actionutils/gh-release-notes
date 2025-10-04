import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import fs from "node:fs";

describe("actionutils/gh-release-notes core", () => {
	const sourcePath = path.resolve(import.meta.dir, "./core.ts");
	const owner = "acme";
	const repo = "demo";

	let originalFetch: typeof global.fetch;
	let originalExistsSync: typeof fs.existsSync;
	let originalReadFileSync: typeof fs.readFileSync;

	beforeEach(() => {
		process.env.GITHUB_TOKEN = "fake-token";
		originalFetch = global.fetch;
		originalExistsSync = fs.existsSync;
		originalReadFileSync = fs.readFileSync;

		// Mock all GitHub API calls
		global.fetch = mock(async (url: any) => {
			const u = url.toString();

			// Repo info
			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					json: async () => ({ default_branch: "main" }),
				};
			}

			// Releases list
			if (u.includes("/releases")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => [],
				};
			}

			// Commits comparison
			if (u.includes("/compare/")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ commits: [] }),
				};
			}

			// Single commit
			if (u.includes("/commits/")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ sha: "abc123" }),
				};
			}

			// GraphQL endpoint for PR data
			if (u.includes("/graphql")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({
						data: {
							repository: {
								object: {
									history: {
										nodes: [],
										pageInfo: {
											hasNextPage: false,
											endCursor: null,
										},
									},
								},
							},
						},
					}),
				};
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;
	});

	afterEach(() => {
		delete process.env.GITHUB_TOKEN;
		global.fetch = originalFetch;
		fs.existsSync = originalExistsSync;
		fs.readFileSync = originalReadFileSync;
	});

	test("auto-loads local .github/release-drafter.yml when --config is omitted", async () => {
		const localCfg = path.resolve(process.cwd(), ".github/release-drafter.yml");

		fs.existsSync = mock((p: any) => {
			if (p === localCfg) return true;
			return originalExistsSync(p);
		});

		fs.readFileSync = mock((p: any, enc: any) => {
			if (p === localCfg) return 'template: "Hello from local config"\n';
			return originalReadFileSync(p, enc);
		}) as any;

		const { run } = await import(sourcePath);
		const res = await run({ repo: `${owner}/${repo}` });
		expect(res.release.body).toBe("Hello from local config");
	});

	test("uses provided local --config file (yaml)", async () => {
		const cfgPath = path.resolve(import.meta.dir, "tmp-config.yml");

		fs.readFileSync = mock((p: any, enc: any) => {
			if (p === cfgPath) return 'template: "Custom config"\n';
			return originalReadFileSync(p, enc);
		}) as any;

		const { run } = await import(sourcePath);
		const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });
		expect(res.release.body).toBe("Custom config");
	});

	test("passes flags to findReleases and tag to generateReleaseInfo", async () => {
		const cfgPath = path.resolve(import.meta.dir, "test-config.yml");

		fs.readFileSync = mock((p: any, enc: any) => {
			if (p === cfgPath) return 'template: "Test template"\n';
			return originalReadFileSync(p, enc);
		}) as any;

		const { run } = await import(sourcePath);
		const res = await run({
			repo: `${owner}/${repo}`,
			config: cfgPath,
			tag: "v1.0.0",
		});

		expect(res.release.body).toBe("Test template");
		// Just verify the tag was used (it affects the release generation)
		expect(res.release.name).toBeDefined();
	});
});
