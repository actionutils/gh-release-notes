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
			const loader = new PurlGitHubConfigLoader();

			await expect(loader.load("pkg:npm/package#file.json")).rejects.toThrow(
				"Unsupported purl type: npm",
			);
		});

		test("throws when subpath is missing", async () => {
			const loader = new PurlGitHubConfigLoader();

			await expect(loader.load("pkg:github/owner/repo")).rejects.toThrow(
				"purl must include a subpath",
			);
		});

		test("throws when subpath is missing with version", async () => {
			const loader = new PurlGitHubConfigLoader();

			await expect(loader.load("pkg:github/owner/repo@v1.0.0")).rejects.toThrow(
				"purl must include a subpath",
			);
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
			});

			const loader = new PurlGitHubConfigLoader();
			const result = await loader.load(
				"pkg:github/owner/repo#.github/config.yaml",
			);

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
			});

			const loader = new PurlGitHubConfigLoader();
			const result = await loader.load(
				"pkg:github/owner/repo@v1.0.0#config/release.yaml",
			);

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
			);

			const loader = new PurlGitHubConfigLoader();

			// Correct sha256 hash of "Hello, World!"
			const result = await loader.load(
				"pkg:github/owner/repo@main#config.yaml?checksum=sha256:dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
			);

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
			);

			const loader = new PurlGitHubConfigLoader();

			await expect(
				loader.load(
					"pkg:github/owner/repo@main#config.yaml?checksum=sha256:incorrect",
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
			);

			const loader = new PurlGitHubConfigLoader();

			await expect(
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
			);

			const loader = new PurlGitHubConfigLoader();

			await expect(
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
			});

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(capturedHeaders.Authorization).toBe("Bearer provided-token");
		});

		test("uses GITHUB_TOKEN env var", async () => {
			process.env.GITHUB_TOKEN = "env-token";
			const loader = new PurlGitHubConfigLoader();
			let capturedHeaders: any = {};

			global.fetch = mock(async (_url: string | URL, options?: any) => {
				capturedHeaders = options?.headers || {};
				return {
					ok: true,
					text: async () => "content",
				} as Response;
			});

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(capturedHeaders.Authorization).toBe("Bearer env-token");
		});

		test("uses GH_TOKEN env var", async () => {
			delete process.env.GITHUB_TOKEN;
			process.env.GH_TOKEN = "gh-token";
			const loader = new PurlGitHubConfigLoader();
			let capturedHeaders: any = {};

			global.fetch = mock(async (_url: string | URL, options?: any) => {
				capturedHeaders = options?.headers || {};
				return {
					ok: true,
					text: async () => "content",
				} as Response;
			});

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(capturedHeaders.Authorization).toBe("Bearer gh-token");
		});

		// Skip this test - execSync mocking doesn't work properly in Bun
		// test.skip("throws when no token available", async () => { ... });
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
			});

			const loader = new PurlGitHubConfigLoader();
			await loader.load("pkg:github/org/team/repo@main#file.yaml");

			expect(capturedUrl).toContain(
				"/repos/org/team/repo/contents/file.yaml?ref=main",
			);
		});

		test("handles URL-encoded paths", async () => {
			let capturedUrl = "";

			global.fetch = mock(async (url: string | URL) => {
				capturedUrl = url.toString();
				return {
					ok: true,
					text: async () => "content",
				} as Response;
			});

			const loader = new PurlGitHubConfigLoader();
			await loader.load(
				"pkg:github/owner/repo@main#path%20with%20spaces/file.yaml",
			);

			expect(capturedUrl).toContain(
				"/repos/owner/repo/contents/path with spaces/file.yaml?ref=main",
			);
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
			});

			const loader = new PurlGitHubConfigLoader();
			await loader.load("pkg:github/owner/repo#config.yaml");

			expect(defaultBranchFetched).toBe(true);
		});
	});
});
