import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import * as os from "node:os";
import * as fsPromises from "node:fs/promises";

describe("pullRequestsByLabel grouping", () => {
	const sourcePath = path.resolve(import.meta.dir, "./core.ts");
	const owner = "acme";
	const repo = "demo";

	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		process.env.GITHUB_TOKEN = "fake-token";
		originalFetch = global.fetch;
	});

	afterEach(() => {
		delete process.env.GITHUB_TOKEN;
		global.fetch = originalFetch;
	});

	async function writeTmpConfig(contents: string): Promise<string> {
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-labels-"),
		);
		const cfgPath = path.join(tmpDir, "config.yml");
		await fsPromises.writeFile(cfgPath, contents);
		return cfgPath;
	}

	test("groups PR numbers by each label and preserves order", async () => {
		const cfgPath = await writeTmpConfig("template: '$CHANGES'\n");

		// Fetch mock returning three PRs, with labels:
		// #3: labels [cat]
		// #2: labels [cat, dog]
		// #1: no labels
		// Sorting defaults to mergedAt descending in release-drafter
		global.fetch = mock(async (url: string | URL | Request) => {
			const u =
				typeof url === "string"
					? url
					: url instanceof URL
						? url.toString()
						: (url as Request).url;

			if (u.endsWith(`/repos/${owner}/${repo}`)) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({ default_branch: "main" }),
				} as unknown as Response;
			}

			if (u.includes("/releases")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => [],
				} as unknown as Response;
			}

			if (u.includes("/graphql")) {
				return {
					ok: true,
					status: 200,
					headers: new Map([["content-type", "application/json"]]),
					json: async () => ({
						data: {
							search: {
								pageInfo: { hasNextPage: false, endCursor: null },
								nodes: [
									{
										number: 3,
										title: "PR Three",
										url: "https://github.com/owner/repo/pull/3",
										mergedAt: "2024-01-03T00:00:00Z",
										labels: { nodes: [{ name: "cat" }] },
										author: { login: "user3", __typename: "User", url: "" },
									},
									{
										number: 2,
										title: "PR Two",
										url: "https://github.com/owner/repo/pull/2",
										mergedAt: "2024-01-02T00:00:00Z",
										labels: { nodes: [{ name: "cat" }, { name: "dog" }] },
										author: { login: "user2", __typename: "User", url: "" },
									},
									{
										number: 1,
										title: "PR One",
										url: "https://github.com/owner/repo/pull/1",
										mergedAt: "2024-01-01T00:00:00Z",
										labels: { nodes: [] },
										author: { login: "user1", __typename: "User", url: "" },
									},
								],
							},
						},
					}),
				} as unknown as Response;
			}

			throw new Error("Unexpected fetch: " + u);
		}) as unknown as typeof fetch;

		try {
			const { run } = await import(sourcePath);
			const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });

			// Merged order should be [3, 2, 1] by mergedAt desc
			expect(res.mergedPullRequests).toEqual([3, 2, 1]);

			// Grouping by label should include both labels with PR numbers in merged order
			expect(res.pullRequestsByLabel).toBeDefined();
			expect(res.pullRequestsByLabel["cat"]).toEqual([3, 2]);
			expect(res.pullRequestsByLabel["dog"]).toEqual([2]);
			// Unlabeled PR (#1) should not appear under any label key
			expect(Object.values(res.pullRequestsByLabel).flat()).not.toContain(1);
		} finally {
			await fsPromises.rm(path.dirname(cfgPath), { recursive: true });
		}
	});
});
