import { describe, test, expect, beforeEach, afterEach, mock } from "bun:test";
import { PurlGitHubConfigLoader } from "./purl-github-config-loader";

describe("PurlGitHubConfigLoader", () => {
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
			const loader = new PurlGitHubConfigLoader("test-token");

			expect(loader.load("pkg:npm/package#file.json")).rejects.toThrow(
				"Unsupported purl type: npm",
			);
		});

		test("throws when subpath is missing", async () => {
			const loader = new PurlGitHubConfigLoader("test-token");

			expect(loader.load("pkg:github/owner/repo")).rejects.toThrow(
				"purl must include a subpath",
			);
		});

		test("throws when subpath is missing with version", async () => {
			const loader = new PurlGitHubConfigLoader("test-token");

			expect(
				loader.load("pkg:github/owner/repo@v1.0.0"),
			).rejects.toThrow("purl must include a subpath");
		});
	});

	describe("GitHub API interaction", () => {
		test("loads config from GitHub purl", async () => {
			const configContent = "name: GitHub Config";

			global.fetch = mock(async (url: string | URL) => {
				const urlStr = url.toString();

				// Mock API call for default branch
				if (urlStr.endsWith("/repos/owner/repo")) {
					return {
						ok: true,
						json: async () => ({ default_branch: "main" }),
					} as Response;
				}

				// Mock API call for file content
				if (urlStr.includes("/repos/owner/repo/contents/")) {
					return {
						ok: true,
						text: async () => configContent,
					} as Response;
				}

				throw new Error(`Unexpected URL: ${urlStr}`);
			}) as any;

			const loader = new PurlGitHubConfigLoader("test-token");
			const result = (await loader.load(
				"pkg:github/owner/repo#.github/config.yaml",
			)) as any;

			expect(result).toBe(configContent);
		});

		test("loads config with specific version", async () => {
			const configContent = "version: specific";

			global.fetch = mock(async (url: string | URL) => {
				const urlStr = url.toString();

				// Mock API call for file content with specific ref
				if (
					urlStr.includes(
						"/repos/owner/repo/contents/config/release.yaml?ref=v1.0.0",
					)
				) {
					return {
						ok: true,
						text: async () => configContent,
					} as Response;
				}

				throw new Error(`Unexpected URL: ${urlStr}`);
			}) as any;

			const loader = new PurlGitHubConfigLoader("test-token");
			const result = (await loader.load(
				"pkg:github/owner/repo@v1.0.0#config/release.yaml",
			)) as any;

			expect(result).toBe(configContent);
		});

		test("validates checksum when provided", async () => {
			const configContent = "Hello, World!";

			global.fetch = mock(
				async () =>
					({
						ok: true,
						text: async () => configContent,
					}) as Response,
			) as any;

			const loader = new PurlGitHubConfigLoader("test-token");

			// Correct sha256 hash of "Hello, World!"
			const result = (await loader.load(
				"pkg:github/owner/repo@main?checksum=sha256:dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f#config.yaml",
			)) as any;

			expect(result).toBe(configContent);
		});

		test("throws on checksum mismatch", async () => {
			const configContent = "Hello, World!";

			global.fetch = mock(
				async () =>
					({
						ok: true,
						text: async () => configContent,
					}) as Response,
			) as any;

			const loader = new PurlGitHubConfigLoader("test-token");

			expect(
				loader.load(
					"pkg:github/owner/repo@main?checksum=sha256:incorrect#config.yaml",
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
			) as any;

			const loader = new PurlGitHubConfigLoader("test-token");

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
			) as any;

			const loader = new PurlGitHubConfigLoader("test-token");

			expect(
				loader.load("pkg:github/owner/repo@main#large.yaml"),
			).rejects.toThrow("Config file too large");
		});
	});

	describe("token resolution", () => {
		test("uses provided token", async () => {
			const loader = new PurlGitHubConfigLoader("provided-token");
			let capturedHeaders: any = {};

			global.fetch = mock(async (_url: string | URL, options?: any) => {
				capturedHeaders = options?.headers || {};
				return {
					ok: true,
					text: async () => "content",
				} as Response;
			}) as any;

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
				} as Response;
			}) as any;

			const loader = new PurlGitHubConfigLoader("test-token");
			await loader.load("pkg:github/org/team/repo@main#file.yaml");

			expect(capturedUrl).toContain(
				"/repos/org/team/repo/contents/file.yaml?ref=main",
			) as any;
		});

		test("handles URL-encoded paths", async () => {
			let capturedUrl = "";

			global.fetch = mock(async (url: string | URL) => {
				capturedUrl = url.toString();
				return {
					ok: true,
					text: async () => "content",
				} as Response;
			}) as any;

			const loader = new PurlGitHubConfigLoader("test-token");
			(await loader.load(
				"pkg:github/owner/repo@main#path%20with%20spaces/file.yaml",
			)) as any;

			expect(capturedUrl).toContain(
				"/repos/owner/repo/contents/path with spaces/file.yaml?ref=main",
			) as any;
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
					} as Response;
				}

				if (urlStr.includes("?ref=develop")) {
					return {
						ok: true,
						text: async () => "content",
					} as Response;
				}

				throw new Error(`Unexpected URL: ${urlStr}`);
			}) as any;

			const loader = new PurlGitHubConfigLoader("test-token");
			await loader.load("pkg:github/owner/repo#config.yaml");

			expect(defaultBranchFetched).toBe(true);
		});
	});
});
