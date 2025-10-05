import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { HTTPSConfigLoader } from "./https-config-loader";

describe("HTTPSConfigLoader", () => {
	let loader: HTTPSConfigLoader;
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		loader = new HTTPSConfigLoader();
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("loads config from HTTPS URL", async () => {
		const configContent = "name: Remote Config\nversion: 2.0";

		const mockFetch = mock(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					text: async () => configContent,
				}) as Response,
		);

		global.fetch = mockFetch as any;

		const result = await loader.load("https://example.com/config.yaml");

		expect(result).toBe(configContent);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://example.com/config.yaml",
			expect.objectContaining({
				headers: {
					"User-Agent": "gh-release-notes",
				},
			}),
		);
	});

	it("throws error on non-200 response", async () => {
		const mockFetch = mock(
			async () =>
				({
					ok: false,
					status: 404,
					statusText: "Not Found",
					text: async () => "Not Found",
				}) as Response,
		);

		global.fetch = mockFetch as any;

		expect(
			loader.load("https://example.com/nonexistent.yaml"),
		).rejects.toThrow(
			"Failed to fetch config from https://example.com/nonexistent.yaml: Failed to fetch config: HTTP 404 Not Found",
		);
	});

	it("throws error on network failure", async () => {
		const mockFetch = mock(async () => {
			throw new Error("Network error");
		});

		global.fetch = mockFetch as any;

		expect(
			loader.load("https://example.com/config.yaml"),
		).rejects.toThrow("Network error");
	});

	it("only accepts HTTPS URLs", async () => {
		expect(loader.load("http://example.com/config.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);

		expect(loader.load("ftp://example.com/config.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);

		expect(loader.load("file:///local/config.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);
	});

	it("adds User-Agent header to requests", async () => {
		const mockFetch = mock(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					text: async () => "config content",
				}) as Response,
		);

		global.fetch = mockFetch as any;

		await loader.load("https://example.com/config.yaml");

		expect(mockFetch).toHaveBeenCalledWith(
			"https://example.com/config.yaml",
			expect.objectContaining({
				headers: {
					"User-Agent": "gh-release-notes",
				},
			}),
		);
	});
});
