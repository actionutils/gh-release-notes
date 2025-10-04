import {
	describe,
	it,
	expect,
	jest,
	beforeEach,
	afterEach,
} from "@jest/globals";
import { PurlGitHubConfigLoader } from "../purl-github-config-loader";
import { execSync } from "node:child_process";
import { mock } from "bun:test";

// Mock global fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe("PurlGitHubConfigLoader", () => {
	let loader: PurlGitHubConfigLoader;
	const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;
	let originalExecSync: typeof execSync;

	beforeEach(() => {
		jest.clearAllMocks();
		delete process.env.GITHUB_TOKEN;
		delete process.env.GH_TOKEN;
		originalExecSync = execSync;
	});

	afterEach(() => {
		jest.restoreAllMocks();
		(require("node:child_process") as any).execSync = originalExecSync;
	});

	describe("with token", () => {
		beforeEach(() => {
			process.env.GITHUB_TOKEN = "test-token";
			loader = new PurlGitHubConfigLoader();
		});

		it("loads config from GitHub purl", async () => {
			const configContent = "name: GitHub Config";

			// Mock API call for default branch
			mockFetch
				.mockResolvedValueOnce({
					ok: true,
					json: async () => ({ default_branch: "main" }),
				} as Response)
				// Mock API call for file content
				.mockResolvedValueOnce({
					ok: true,
					text: async () => configContent,
				} as Response);

			const result = await loader.load(
				"pkg:github/owner/repo#.github/config.yaml",
			);

			expect(result).toBe(configContent);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/repos/owner/repo",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
					}),
				}),
			);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/repos/owner/repo/contents/.github/config.yaml?ref=main",
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer test-token",
						Accept: "application/vnd.github.v3.raw",
					}),
				}),
			);
		});

		it("loads config with specific version", async () => {
			const configContent = "version: specific";

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => configContent,
			} as Response);

			const result = await loader.load(
				"pkg:github/owner/repo@v1.0.0#config/release.yaml",
			);

			expect(result).toBe(configContent);
			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/repos/owner/repo/contents/config/release.yaml?ref=v1.0.0",
				expect.any(Object),
			);
		});

		it("validates checksum when provided", async () => {
			const configContent = "Hello, World!";

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => configContent,
			} as Response);

			// Correct sha256 hash of "Hello, World!"
			const result = await loader.load(
				"pkg:github/owner/repo@main#config.yaml?checksum=sha256:dffd6021bb2bd5b0af676290809ec3a53191dd81c7f70a4b28688a362182986f",
			);

			expect(result).toBe(configContent);
		});

		it("throws on checksum mismatch", async () => {
			const configContent = "Hello, World!";

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => configContent,
			} as Response);

			await expect(
				loader.load(
					"pkg:github/owner/repo@main#config.yaml?checksum=sha256:incorrect",
				),
			).rejects.toThrow("Checksum validation failed");
		});

		it("throws on non-GitHub purl", async () => {
			await expect(
				loader.load("pkg:npm/package#file.json"),
			).rejects.toThrow("Unsupported purl type: npm");
		});

		it("throws when subpath is missing", async () => {
			await expect(loader.load("pkg:github/owner/repo")).rejects.toThrow(
				"purl must include a subpath",
			);
		});

		it("handles 404 errors", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: false,
				status: 404,
				statusText: "Not Found",
			} as Response);

			await expect(
				loader.load("pkg:github/owner/repo@main#missing.yaml"),
			).rejects.toThrow("File not found: missing.yaml");
		});

		it("enforces size limit", async () => {
			const largeContent = "x".repeat(1024 * 1024 + 1);

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => largeContent,
			} as Response);

			await expect(
				loader.load("pkg:github/owner/repo@main#large.yaml"),
			).rejects.toThrow("Config file too large");
		});
	});

	describe("token resolution", () => {
		it("uses provided token", async () => {
			loader = new PurlGitHubConfigLoader("provided-token");

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => "content",
			} as Response);

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer provided-token",
					}),
				}),
			);
		});

		it("uses GITHUB_TOKEN env var", async () => {
			process.env.GITHUB_TOKEN = "env-token";
			loader = new PurlGitHubConfigLoader();

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => "content",
			} as Response);

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer env-token",
					}),
				}),
			);
		});

		it("uses GH_TOKEN env var", async () => {
			process.env.GH_TOKEN = "gh-token";
			loader = new PurlGitHubConfigLoader();

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => "content",
			} as Response);

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer gh-token",
					}),
				}),
			);
		});

		it("uses gh auth token", async () => {
			const mockExec = mock(() => "cli-token\n");
			(require("node:child_process") as any).execSync = mockExec;
			loader = new PurlGitHubConfigLoader();

			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => "content",
			} as Response);

			await loader.load("pkg:github/owner/repo@main#file.yaml");

			expect(mockExec).toHaveBeenCalledWith();
			expect(mockFetch).toHaveBeenCalledWith(
				expect.any(String),
				expect.objectContaining({
					headers: expect.objectContaining({
						Authorization: "Bearer cli-token",
					}),
				}),
			);
		});

		it("throws when no token available", async () => {
			const mockExec = mock(() => {
				throw new Error("gh not found");
			});
			(require("node:child_process") as any).execSync = mockExec;
			loader = new PurlGitHubConfigLoader();

			await expect(
				loader.load("pkg:github/owner/repo@main#file.yaml"),
			).rejects.toThrow("GitHub token required");
		});
	});

	describe("purl parsing", () => {
		beforeEach(() => {
			process.env.GITHUB_TOKEN = "test-token";
			loader = new PurlGitHubConfigLoader();
		});

		it("handles nested namespaces", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => "content",
			} as Response);

			await loader.load("pkg:github/org/team/repo@main#file.yaml");

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/repos/org/team/repo/contents/file.yaml?ref=main",
				expect.any(Object),
			);
		});

		it("handles URL-encoded paths", async () => {
			mockFetch.mockResolvedValueOnce({
				ok: true,
				text: async () => "content",
			} as Response);

			await loader.load(
				"pkg:github/owner/repo@main#path%20with%20spaces/file.yaml",
			);

			expect(mockFetch).toHaveBeenCalledWith(
				"https://api.github.com/repos/owner/repo/contents/path with spaces/file.yaml?ref=main",
				expect.any(Object),
			);
		});
	});
});
