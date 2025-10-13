import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import fs from "node:fs";
import * as os from "node:os";
import * as fsPromises from "node:fs/promises";

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
					headers: new Map([["content-type", "application/json"]]),
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
							search: {
								nodes: [],
								pageInfo: { hasNextPage: false, endCursor: null },
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

	test("detects new contributors when $NEW_CONTRIBUTORS placeholder exists", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(path.join(os.tmpdir(), "test-nc-"));
		const cfgPath = path.join(tmpDir, "test-nc-config.yml");
		await fsPromises.writeFile(
			cfgPath,
			'template: "## New Contributors\n$NEW_CONTRIBUTORS"\n',
		);

		// Override fetch mock to include PR data with authors
		let graphqlCallCount = 0;
		global.fetch = mock(async (url: any) => {
			const u = url.toString();

			// Repo info
			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ default_branch: "main" }),
				};
			}

			// Get release by tag
			if (u.includes("/releases/tags/v1.0.0")) {
				const releaseData = {
					tag_name: "v1.0.0",
					published_at: "2023-12-01T00:00:00Z",
					created_at: "2023-12-01T00:00:00Z",
				};
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => releaseData,
					text: async () => JSON.stringify(releaseData),
				};
			}

			// Releases list - return a previous release for baseline
			if (u.includes("/releases")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => [
						{
							tag_name: "v1.0.0",
							published_at: "2023-12-01T00:00:00Z",
							created_at: "2023-12-01T00:00:00Z",
						},
					],
				};
			}

			// GraphQL endpoint - return different responses based on call order
			if (u.includes("/graphql")) {
				graphqlCallCount++;

				// First call: PR search
				if (graphqlCallCount === 1) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							data: {
								search: {
									pageInfo: { hasNextPage: false, endCursor: null },
									nodes: [
										{
											number: 10,
											title: "First PR",
											url: "https://github.com/owner/repo/pull/10",
											mergedAt: "2024-01-01T00:00:00Z",
											labels: { nodes: [] },
											author: { login: "newuser", __typename: "User", url: "" },
										},
									],
								},
							},
						}),
					};
				}

				// Second call: Batch contributor check (searching for PRs before 2023-12-01)
				// Since newuser has no PRs before the date, they are a new contributor
				if (graphqlCallCount === 2) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							data: {
								newuser: {
									issueCount: 0, // No PRs before the previous release date
									nodes: [],
								},
							},
						}),
					};
				}
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			const res = await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
				prevTag: "v1.0.0",
			});

			expect(res.release.body).toContain("## New Contributors");
			expect(res.release.body).toContain(
				"@newuser made their first contribution",
			);
			expect(res.newContributors).toBeDefined();
			expect(Array.isArray(res.newContributors)).toBe(true);
			expect(res.newContributors?.length).toBe(1);
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});

	test("skips new contributors when no previous release exists", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-no-prev-"),
		);
		const cfgPath = path.join(tmpDir, "test-no-prev-config.yml");
		await fsPromises.writeFile(
			cfgPath,
			'template: "## Release\n$CHANGES\n$NEW_CONTRIBUTORS"\n',
		);

		let graphqlCallCount = 0;
		global.fetch = mock(async (url: any) => {
			const u = url.toString();

			// Repo info
			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ default_branch: "main" }),
				};
			}

			// Releases list - return empty (no previous releases)
			if (u.includes("/releases")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => [],
				};
			}

			if (u.includes("/graphql")) {
				graphqlCallCount++;

				// First call: PR search
				if (graphqlCallCount === 1) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							data: {
								search: {
									pageInfo: { hasNextPage: false, endCursor: null },
									nodes: [
										{
											number: 1,
											title: "Initial commit",
											url: "https://github.com/owner/repo/pull/1",
											mergedAt: "2024-01-01T00:00:00Z",
											labels: { nodes: [] },
											author: { login: "user1", __typename: "User", url: "" },
										},
									],
								},
							},
						}),
					};
				}
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			const res = await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
			});

			// Should NOT contain new contributors section when no previous release
			expect(res.release.body).not.toContain("## New Contributors");
			expect(res.release.body).not.toContain("made their first contribution");
			expect(res.newContributors).toBeNull();

			// Should have made only 1 GraphQL call (for PR search)
			expect(graphqlCallCount).toBe(1);
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});

	test("includes new contributors when template has placeholder and not skipped", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-basic-"),
		);
		const cfgPath = path.join(tmpDir, "test-basic-config.yml");
		await fsPromises.writeFile(
			cfgPath,
			'template: "## Changes\n$PULL_REQUESTS\n$NEW_CONTRIBUTORS"\n',
		);

		// Override fetch mock to include PR data
		let graphqlCallCount = 0;
		global.fetch = mock(async (url: any) => {
			const u = url.toString();

			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ default_branch: "main" }),
				};
			}

			// Get release by tag for v0.9.0
			if (u.includes("/releases/tags/v0.9.0")) {
				const releaseData = {
					tag_name: "v0.9.0",
					published_at: "2023-11-01T00:00:00Z",
					created_at: "2023-11-01T00:00:00Z",
				};
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => releaseData,
					text: async () => JSON.stringify(releaseData),
				};
			}

			// Releases list - return a previous release for baseline
			if (u.includes("/releases")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => [
						{
							tag_name: "v0.9.0",
							published_at: "2023-11-01T00:00:00Z",
							created_at: "2023-11-01T00:00:00Z",
						},
					],
				};
			}

			if (u.includes("/graphql")) {
				graphqlCallCount++;

				// First call: PR search
				if (graphqlCallCount === 1) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							data: {
								search: {
									pageInfo: { hasNextPage: false, endCursor: null },
									nodes: [
										{
											number: 20,
											title: "Bot PR",
											url: "https://github.com/owner/repo/pull/20",
											mergedAt: "2024-01-02T00:00:00Z",
											labels: { nodes: [] },
											author: {
												login: "github-actions",
												__typename: "Bot",
												url: "https://github.com/apps/github-actions",
												avatarUrl:
													"https://avatars.githubusercontent.com/in/15368?v=4",
											},
										},
									],
								},
							},
						}),
					};
				}

				// Second call: Batch contributor check (searching for PRs before 2023-11-01)
				if (graphqlCallCount === 2) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							data: {
								github_actions: {
									// The alias for github-actions becomes github_actions
									issueCount: 0, // No PRs before the previous release date
									nodes: [],
								},
							},
						}),
					};
				}
			}

			// REST for bot avatar (placed outside GraphQL condition)
			if (u.endsWith("/users/github-actions%5Bbot%5D")) {
				const user = {
					login: "github-actions[bot]",
					avatarUrl: "https://avatars.githubusercontent.com/in/15368?v=4",
					type: "Bot",
				};
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => user,
					text: async () => JSON.stringify(user),
				};
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			const res = await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
				prevTag: "v0.9.0",
			});

			// Should have new contributors array even without placeholder
			expect(res.newContributors).toBeDefined();
			expect(Array.isArray(res.newContributors)).toBe(true);
			expect(res.newContributors?.length).toBe(1);
			expect(res.newContributors?.[0].login).toBe("github-actions");
			expect(res.newContributors?.[0].__typename).toBe("Bot");

			// Should include minimal contributors list in run() result
			expect(res.contributors).toBeDefined();
			expect(res.contributors.length).toBe(1);
			expect(res.contributors[0].login).toBe("github-actions");
			expect(res.contributors[0].__typename).toBe("Bot");
			expect(res.contributors[0].avatarUrl).toBe(
				"https://avatars.githubusercontent.com/in/15368?v=4",
			);
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});

	test("skips new contributors when skipNewContributors flag is set", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-skip-"),
		);
		const cfgPath = path.join(tmpDir, "test-skip-config.yml");
		await fsPromises.writeFile(
			cfgPath,
			'template: "## Changes\n$PULL_REQUESTS\n$NEW_CONTRIBUTORS"\n',
		);

		// Override fetch mock
		let graphqlCallCount = 0;
		global.fetch = mock(async (url: any) => {
			const u = url.toString();

			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ default_branch: "main" }),
				};
			}

			// Get release by tag for v0.9.0
			if (u.includes("/releases/tags/v0.9.0")) {
				const releaseData = {
					tag_name: "v0.9.0",
					published_at: "2023-11-01T00:00:00Z",
					created_at: "2023-11-01T00:00:00Z",
				};
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => releaseData,
					text: async () => JSON.stringify(releaseData),
				};
			}

			// Releases list
			if (u.includes("/releases")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => [
						{
							tag_name: "v0.9.0",
							published_at: "2023-11-01T00:00:00Z",
							created_at: "2023-11-01T00:00:00Z",
						},
					],
				};
			}

			if (u.includes("/graphql")) {
				graphqlCallCount++;

				// Should only get PR search, not contributor check
				if (graphqlCallCount === 1) {
					return {
						ok: true,
						status: 200,
						json: async () => ({
							data: {
								search: {
									pageInfo: { hasNextPage: false, endCursor: null },
									nodes: [
										{
											number: 20,
											title: "Test PR",
											url: "https://github.com/owner/repo/pull/20",
											mergedAt: "2024-01-02T00:00:00Z",
											labels: { nodes: [] },
											author: {
												login: "testuser",
												__typename: "User",
												url: "https://github.com/testuser",
												avatarUrl:
													"https://avatars.githubusercontent.com/u/123?v=4",
											},
										},
									],
								},
							},
						}),
					};
				}

				// Should not reach here if skipNewContributors works
				throw new Error("Unexpected GraphQL call for contributor check");
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			const res = await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
				skipNewContributors: true,
				prevTag: "v0.9.0",
			});

			// Should NOT have new contributors data when skipped
			expect(res.newContributors).toBeNull();
			// Should still have regular contributors list
			expect(res.contributors).toBeDefined();
			expect(res.contributors.length).toBe(1);
			// Only 1 GraphQL call should have been made (for PRs)
			expect(graphqlCallCount).toBe(1);
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});

	test("auto sponsor-fetch-mode detects GitHub App token", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-sponsor-mode-"),
		);
		const cfgPath = path.join(tmpDir, "test-sponsor-config.yml");
		await fsPromises.writeFile(cfgPath, 'template: "$CHANGES"\n');

		// Set GitHub App token (ghs_ prefix)
		process.env.GITHUB_TOKEN = "ghs_testtoken123";

		let sponsorFetchMode: string | undefined;
		global.fetch = mock(async (url: any, options?: any) => {
			const u = url.toString();

			// Repo info
			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
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

			// GraphQL - check the query to detect sponsor fetch mode
			if (u.includes("/graphql")) {
				const body = JSON.parse(options?.body || "{}");
				if (body.variables?.withSponsor === true) {
					sponsorFetchMode = "graphql";
				} else if (body.variables?.withSponsor === false) {
					sponsorFetchMode = "none";
				}

				return {
					ok: true,
					status: 200,
					json: async () => ({
						data: {
							search: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [],
							},
						},
					}),
				};
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
				isJsonMode: true, // JSON mode enabled
				// sponsorFetchMode not specified, should auto-detect
			});

			// With GitHub App token and JSON mode, should NOT use GraphQL for sponsors
			expect(sponsorFetchMode).toBe("none");
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});

	test("auto sponsor-fetch-mode detects non-GitHub App token", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-sponsor-mode2-"),
		);
		const cfgPath = path.join(tmpDir, "test-sponsor-config.yml");
		await fsPromises.writeFile(cfgPath, 'template: "$CHANGES"\n');

		// Set user token (ghp_ prefix)
		process.env.GITHUB_TOKEN = "ghp_testtoken123";

		let sponsorFetchMode: string | undefined;
		global.fetch = mock(async (url: any, options?: any) => {
			const u = url.toString();

			// Repo info
			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
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

			// GraphQL - check the query to detect sponsor fetch mode
			if (u.includes("/graphql")) {
				const body = JSON.parse(options?.body || "{}");
				if (body.variables?.withSponsor === true) {
					sponsorFetchMode = "graphql";
				} else if (body.variables?.withSponsor === false) {
					sponsorFetchMode = "none";
				}

				return {
					ok: true,
					status: 200,
					json: async () => ({
						data: {
							search: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [],
							},
						},
					}),
				};
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
				isJsonMode: true, // JSON mode enabled
				// sponsorFetchMode not specified, should auto-detect
			});

			// With non-GitHub App token and JSON mode, should use GraphQL for sponsors
			expect(sponsorFetchMode).toBe("graphql");
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});

	test("auto sponsor-fetch-mode uses none when not in JSON mode", async () => {
		// Create a real temp file for the config
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-sponsor-mode3-"),
		);
		const cfgPath = path.join(tmpDir, "test-sponsor-config.yml");
		await fsPromises.writeFile(cfgPath, 'template: "$CHANGES"\n');

		// Set user token (ghp_ prefix)
		process.env.GITHUB_TOKEN = "ghp_testtoken123";

		let sponsorFetchMode: string | undefined;
		global.fetch = mock(async (url: any, options?: any) => {
			const u = url.toString();

			// Repo info
			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
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

			// GraphQL - check the query to detect sponsor fetch mode
			if (u.includes("/graphql")) {
				const body = JSON.parse(options?.body || "{}");
				if (body.variables?.withSponsor === true) {
					sponsorFetchMode = "graphql";
				} else if (body.variables?.withSponsor === false) {
					sponsorFetchMode = "none";
				}

				return {
					ok: true,
					status: 200,
					json: async () => ({
						data: {
							search: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [],
							},
						},
					}),
				};
			}

			throw new Error("Unexpected fetch: " + u);
		}) as any;

		try {
			const { run } = await import(sourcePath);
			await run({
				repo: `${owner}/${repo}`,
				config: cfgPath,
				isJsonMode: false, // JSON mode disabled
				// sponsorFetchMode not specified, should auto-detect
			});

			// Without JSON mode, should not fetch sponsors
			expect(sponsorFetchMode).toBe("none");
		} finally {
			// Cleanup
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});
});
