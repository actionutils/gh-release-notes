import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import path from "node:path";
import * as os from "node:os";
import * as fsPromises from "node:fs/promises";

describe("include-paths via GraphQL files filter", () => {
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

	test("filters PRs by include-paths using GraphQL PR files", async () => {
		const tmpDir = await fsPromises.mkdtemp(
			path.join(os.tmpdir(), "test-inc-"),
		);
		const cfgPath = path.join(tmpDir, "config.yml");
		await fsPromises.writeFile(
			cfgPath,
			[
				"template: '$CHANGES'",
				"categories:",
				"  - title: Cat",
				"    labels: ['cat']",
				"include-paths:",
				"  - 'src/keep'",
			].join("\n"),
		);

		let graphqlCallCount = 0;
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
				graphqlCallCount++;
				// 1st: PR search
				if (graphqlCallCount === 1) {
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
											number: 1,
											title: "Touch src/keep",
											mergedAt: "2024-01-01T00:00:00Z",
											labels: { nodes: [{ name: "cat" }] },
											author: { login: "user", __typename: "User", url: "" },
										},
										{
											number: 2,
											title: "Touch docs",
											mergedAt: "2024-01-02T00:00:00Z",
											labels: { nodes: [{ name: "cat" }] },
											author: { login: "user", __typename: "User", url: "" },
										},
									],
								},
							},
						}),
					} as unknown as Response;
				}
				// 2nd: Files batch for PRs 1 and 2
				if (graphqlCallCount === 2) {
					return {
						ok: true,
						status: 200,
						headers: new Map([["content-type", "application/json"]]),
						json: async () => ({
							data: {
								repo: {
									pr_1: {
										files: {
											pageInfo: { hasNextPage: false, endCursor: null },
											nodes: [
												{ path: "src/keep/file.ts", previousFilePath: null },
											],
										},
									},
									pr_2: {
										files: {
											pageInfo: { hasNextPage: false, endCursor: null },
											nodes: [
												{ path: "docs/readme.md", previousFilePath: null },
											],
										},
									},
								},
							},
						}),
					} as unknown as Response;
				}
			}
			throw new Error("Unexpected fetch: " + u);
		}) as unknown as typeof fetch;

		try {
			const { run } = await import(sourcePath);
			const res = await run({ repo: `${owner}/${repo}`, config: cfgPath });
			const numbers = (res.mergedPullRequests || []).map(
				(p: { number: number }) => p.number,
			);
			expect(numbers).toEqual([1]);
		} finally {
			await fsPromises.rm(tmpDir, { recursive: true });
		}
	});
});
