import { describe, it, expect, beforeEach, afterEach, mock } from "bun:test";
import { HTTPSContentLoader } from "./https-content-loader";

describe("HTTPSContentLoader", () => {
	let loader: HTTPSContentLoader;
	let originalFetch: typeof global.fetch;

	beforeEach(() => {
		loader = new HTTPSContentLoader();
		originalFetch = global.fetch;
	});

	afterEach(() => {
		global.fetch = originalFetch;
	});

	it("loads content from HTTPS URL", async () => {
		const contentContent = "name: Remote Config\nversion: 2.0";

		const mockFetch = mock(
			async () =>
				({
					ok: true,
					status: 200,
					statusText: "OK",
					text: async () => contentContent,
				}) as Response,
		);

		global.fetch = mockFetch as unknown as typeof fetch;

		const result = await loader.load("https://example.com/content.yaml");

		expect(result).toBe(contentContent);
		expect(mockFetch).toHaveBeenCalledWith(
			"https://example.com/content.yaml",
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

		global.fetch = mockFetch as unknown as typeof fetch;

		expect(loader.load("https://example.com/nonexistent.yaml")).rejects.toThrow(
			"Failed to fetch content from https://example.com/nonexistent.yaml: Failed to fetch content: HTTP 404 Not Found",
		);
	});

	it("throws error on network failure", async () => {
		const mockFetch = mock(async () => {
			throw new Error("Network error");
		});

		global.fetch = mockFetch as unknown as typeof fetch;

		expect(loader.load("https://example.com/content.yaml")).rejects.toThrow(
			"Network error",
		);
	});

	it("only accepts HTTPS URLs", async () => {
		expect(loader.load("http://example.com/content.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);

		expect(loader.load("ftp://example.com/content.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);

		expect(loader.load("file:///local/content.yaml")).rejects.toThrow(
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
					text: async () => "content content",
				}) as Response,
		);

		global.fetch = mockFetch as unknown as typeof fetch;

		await loader.load("https://example.com/content.yaml");

		expect(mockFetch).toHaveBeenCalledWith(
			"https://example.com/content.yaml",
			expect.objectContaining({
				headers: {
					"User-Agent": "gh-release-notes",
				},
			}),
		);
	});
});
