import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { PurlGitHubContentLoader } from "./purl-github-content-loader";

describe("PurlGitHubContentLoader", () => {
	let originalFetch: typeof global.fetch;
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalFetch = global.fetch;
		originalEnv = { ...process.env };

		// Set up a mock token
		process.env.GITHUB_TOKEN = "test-token";
	});

	afterEach(() => {
		global.fetch = originalFetch;
		process.env = originalEnv;
	});

	describe("purl parsing and validation", () => {
		test("throws on non-GitHub purl", async () => {
			const loader = new PurlGitHubContentLoader("test-token");

			expect(loader.load("pkg:npm/package#file.json")).rejects.toThrow(
				"Unsupported purl type: npm",
			);
		});

		test("throws when subpath is missing", async () => {
			const loader = new PurlGitHubContentLoader("test-token");

			expect(loader.load("pkg:github/owner/repo")).rejects.toThrow(
				"purl must include a subpath",
			);
		});

		test("throws when subpath is missing with version", async () => {
			const loader = new PurlGitHubContentLoader("test-token");

			expect(loader.load("pkg:github/owner/repo@v1.0.0")).rejects.toThrow(
				"purl must include a subpath",
			);
		});
	});

	describe("GitHub API interaction", () => {
		test("loads content from GitHub purl", async () => {
			const contentContent = "name: GitHub Config";

			global.fetch = mock(async (url: string | URL) => {
				const urlStr = url.toString();

				// Mock API call for default branch
				if (urlStr.endsWith("/repos/owner/repo")) {
					return {
						ok: true,
						json: async () => ({ default_branch: "main" }),
					} as unknown as Response;
				}

				// Mock API call for file content
				if (urlStr.includes("/repos/owner/repo/contents/")) {
					return {
						ok: true,
						text: async () => contentContent,
					} as unknown as Response;
				}

				throw new Error(`Unexpected URL: ${urlStr}`);
			}) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");
			const result = (await loader.load(
				"pkg:github/owner/repo#.github/content.yaml",
			)) as string;

			expect(result).toBe(contentContent);
		});

		test("loads content with specific version", async () => {
			const contentContent = "version: specific";

			global.fetch = mock(async (url: string | URL) => {
				const urlStr = url.toString();

				// Mock API call for file content with specific ref
				if (
					urlStr.includes(
						"/repos/owner/repo/contents/content/release.yaml?ref=v1.0.0",
					)
				) {
					return {
						ok: true,
						text: async () => contentContent,
					} as unknown as Response;
				}

				throw new Error(`Unexpected URL: ${urlStr}`);
			}) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");
			const result = (await loader.load(
				"pkg:github/owner/repo@v1.0.0#content/release.yaml",
			)) as string;

			expect(result).toBe(contentContent);
		});

		test("validates checksum when provided", async () => {
			const contentContent = "Hello, World!";

			global.fetch = mock(
				async () =>
					({
						ok: true,
						text: async () => contentContent,
					}) as Response,
			) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");

			// Correct sha256 hash of "Hello, World!"
			const result = (await loader.load(
				"pkg:github/owner/repo@main?checksum=sha256:dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f#content.yaml",
			)) as string;

			expect(result).toBe(contentContent);
		});

		test("throws on checksum mismatch", async () => {
			const contentContent = "Hello, World!";

			global.fetch = mock(
				async () =>
					({
						ok: true,
						text: async () => contentContent,
					}) as Response,
			) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");

			expect(
				loader.load(
					"pkg:github/owner/repo@main?checksum=sha256:incorrect#content.yaml",
				),
			).rejects.toThrow("Checksum validation failed");
		});

		test("handles 404 errors", async () => {
			global.fetch = mock(
				async () =>
					({
						ok: false,
						status: 404,
						statusText: "Not Found",
					}) as Response,
			) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");

			expect(
				loader.load("pkg:github/owner/repo@main#missing.yaml"),
			).rejects.toThrow("File not found: missing.yaml");
		});

		test("enforces size limit", async () => {
			const largeContent = "x".repeat(1024 * 1024 + 1);

			global.fetch = mock(
				async () =>
					({
						ok: true,
						text: async () => largeContent,
					}) as Response,
			) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");

			expect(
				loader.load("pkg:github/owner/repo@main#large.yaml"),
			).rejects.toThrow("Content file too large");
		});
	});

	describe("token resolution", () => {
		test("uses provided token", async () => {
			const loader = new PurlGitHubContentLoader("provided-token");
			let capturedHeaders: Record<string, unknown> = {};

			global.fetch = mock(
				async (
					_url: string | URL,
					options?: { headers?: Record<string, unknown> },
				) => {
					capturedHeaders = options?.headers || {};
					return {
						ok: true,
						text: async () => "content",
					} as unknown as Response;
				},
			) as unknown as typeof fetch;

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(capturedHeaders.Authorization).toBe("Bearer provided-token");
		});
	});

	describe("purl format handling", () => {
		test("handles nested namespaces", async () => {
			let capturedUrl = "";

			global.fetch = mock(async (url: string | URL) => {
				capturedUrl = url.toString();
				return {
					ok: true,
					text: async () => "content",
				} as unknown as Response;
			}) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");
			await loader.load("pkg:github/org/team/repo@main#file.yaml");

			expect(capturedUrl).toContain(
				"/repos/org/team/repo/contents/file.yaml?ref=main",
			) as unknown as typeof fetch;
		});

		test("handles URL-encoded paths", async () => {
			let capturedUrl = "";

			global.fetch = mock(async (url: string | URL) => {
				capturedUrl = url.toString();
				return {
					ok: true,
					text: async () => "content",
				} as unknown as Response;
			}) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");
			(await loader.load(
				"pkg:github/owner/repo@main#path%20with%20spaces/file.yaml",
			)) as string;

			expect(capturedUrl).toContain(
				"/repos/owner/repo/contents/path with spaces/file.yaml?ref=main",
			) as unknown as typeof fetch;
		});

		test("fetches default branch when version not specified", async () => {
			let defaultBranchFetched = false;

			global.fetch = mock(async (url: string | URL) => {
				const urlStr = url.toString();

				if (urlStr.endsWith("/repos/owner/repo")) {
					defaultBranchFetched = true;
					return {
						ok: true,
						json: async () => ({ default_branch: "develop" }),
					} as unknown as Response;
				}

				if (urlStr.includes("?ref=develop")) {
					return {
						ok: true,
						text: async () => "content",
					} as unknown as Response;
				}

				throw new Error(`Unexpected URL: ${urlStr}`);
			}) as unknown as typeof fetch;

			const loader = new PurlGitHubContentLoader("test-token");
			await loader.load("pkg:github/owner/repo#content.yaml");

			expect(defaultBranchFetched).toBe(true);
		});
	});
});
