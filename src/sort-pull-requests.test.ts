import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import * as os from "node:os";
import * as fsPromises from "node:fs/promises";

describe("PR sorting via release-drafter", () => {
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
			path.join(os.tmpdir(), "test-sort-"),
		);
		const cfgPath = path.join(tmpDir, "config.yml");
		await fsPromises.writeFile(cfgPath, contents);
		return cfgPath;
	}

	function installFetchMock(options?: {
		titles?: [string, string];
		mergedAt?: [string, string];
	}) {
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
				const [title2, title1] = options?.titles || ["PR Two", "PR One"];
				const [mergedAt2, mergedAt1] = options?.mergedAt || [
					"2024-01-02T00:00:00Z",
					"2024-01-01T00:00:00Z",
				];
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
										number: 2,
										title: title2,
										url: "https://github.com/owner/repo/pull/2",
										mergedAt: mergedAt2,
										labels: { nodes: [{ name: "cat" }] },
										author: { login: "user", __typename: "User", url: "" },
									},
									{
										number: 1,
										title: title1,
										url: "https://github.com/owner/repo/pull/1",
										mergedAt: mergedAt1,
										labels: { nodes: [{ name: "cat" }] },
										author: { login: "user", __typename: "User", url: "" },
									},
								],
							},
						},
					}),
				} as unknown as Response;
			}

			throw new Error("Unexpected fetch: " + u);
		}) as unknown as typeof fetch;
	}

	test("sort-direction ascending sorts by mergedAt ascending and preserves category order", async () => {
		const cfgPath = await writeTmpConfig(
			[
				"template: '$CHANGES'",
				"categories:",
				"  - title: Cat",
				"    labels: ['cat']",
				"sort-direction: 'ascending'",
			].join("\n"),
		);

		installFetchMock();

		const { run } = await import(sourcePath);
		const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });

		// mergedPullRequests should be [1, 2]
		const numbers = (res.mergedPullRequests || []).map(
			(p: { number: number }) => p.number,
		);
		expect(numbers).toEqual([1, 2]);

		// category Cat should preserve the same order
		const cat = res.categorizedPullRequests.categories[0];
		const catNumbers = cat.pullRequests.map(
			(p: { number: number }) => p.number,
		);
		expect(catNumbers).toEqual([1, 2]);

		await fsPromises.rm(path.dirname(cfgPath), { recursive: true });
	});

	test("sort-direction descending sorts by mergedAt descending and preserves category order", async () => {
		const cfgPath = await writeTmpConfig(
			[
				"template: '$CHANGES'",
				"categories:",
				"  - title: Cat",
				"    labels: ['cat']",
				"sort-direction: 'descending'",
			].join("\n"),
		);

		installFetchMock();

		const { run } = await import(sourcePath);
		const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });

		// mergedPullRequests should be [2, 1]
		const numbers = (res.mergedPullRequests || []).map(
			(p: { number: number }) => p.number,
		);
		expect(numbers).toEqual([2, 1]);

		// category Cat should preserve the same order
		const cat = res.categorizedPullRequests.categories[0];
		const catNumbers = cat.pullRequests.map(
			(p: { number: number }) => p.number,
		);
		expect(catNumbers).toEqual([2, 1]);

		await fsPromises.rm(path.dirname(cfgPath), { recursive: true });
	});

	test("sort-by title ascending sorts alphabetically and preserves category order", async () => {
		const cfgPath = await writeTmpConfig(
			[
				"template: '$CHANGES'",
				"categories:",
				"  - title: Cat",
				"    labels: ['cat']",
				"sort-by: 'title'",
				"sort-direction: 'ascending'",
			].join("\n"),
		);

		// Both have same mergedAt so title decides order
		installFetchMock({
			titles: ["B second", "A first"],
			mergedAt: ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"],
		});

		const { run } = await import(sourcePath);
		const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });

		// mergedPullRequests should be [1, 2] because A < B
		const numbers = (res.mergedPullRequests || []).map(
			(p: { number: number }) => p.number,
		);
		expect(numbers).toEqual([1, 2]);

		const cat = res.categorizedPullRequests.categories[0];
		const catNumbers = cat.pullRequests.map(
			(p: { number: number }) => p.number,
		);
		expect(catNumbers).toEqual([1, 2]);

		await fsPromises.rm(path.dirname(cfgPath), { recursive: true });
	});

	test("sort-by title descending sorts reverse-alphabetically and preserves category order", async () => {
		const cfgPath = await writeTmpConfig(
			[
				"template: '$CHANGES'",
				"categories:",
				"  - title: Cat",
				"    labels: ['cat']",
				"sort-by: 'title'",
				"sort-direction: 'descending'",
			].join("\n"),
		);

		// Both have same mergedAt so title decides order
		installFetchMock({
			titles: ["B second", "A first"],
			mergedAt: ["2024-01-01T00:00:00Z", "2024-01-01T00:00:00Z"],
		});

		const { run } = await import(sourcePath);
		const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });

		// mergedPullRequests should be [2, 1] because B > A
		const numbers = (res.mergedPullRequests || []).map(
			(p: { number: number }) => p.number,
		);
		expect(numbers).toEqual([2, 1]);

		const cat = res.categorizedPullRequests.categories[0];
		const catNumbers = cat.pullRequests.map(
			(p: { number: number }) => p.number,
		);
		expect(catNumbers).toEqual([2, 1]);

		await fsPromises.rm(path.dirname(cfgPath), { recursive: true });
	});
});
