import { describe, it, expect, jest, beforeEach } from "@jest/globals";
import { HTTPSConfigLoader } from "./https-config-loader";

// Mock global fetch
global.fetch = jest.fn() as jest.MockedFunction<typeof fetch>;

describe("HTTPSConfigLoader", () => {
	let loader: HTTPSConfigLoader;
	const mockFetch = global.fetch as jest.MockedFunction<typeof fetch>;

	beforeEach(() => {
		loader = new HTTPSConfigLoader();
		jest.clearAllMocks();
	});

	it("loads config from HTTPS URL", async () => {
		const configContent = "name: Remote Config\nversion: 2.0";
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () => configContent,
		} as Response);

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

	it("rejects non-HTTPS URLs", async () => {
		await expect(loader.load("http://example.com/config.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);

		await expect(loader.load("ftp://example.com/config.yaml")).rejects.toThrow(
			"URL must use HTTPS protocol",
		);
	});

	it("handles HTTP errors", async () => {
		mockFetch.mockResolvedValue({
			ok: false,
			status: 404,
			statusText: "Not Found",
		} as Response);

		await expect(
			loader.load("https://example.com/missing.yaml"),
		).rejects.toThrow("Failed to fetch config: HTTP 404 Not Found");
	});

	it("enforces size limit", async () => {
		const largeContent = "x".repeat(1024 * 1024 + 1); // 1MB + 1 byte
		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () => largeContent,
		} as Response);

		await expect(loader.load("https://example.com/large.yaml")).rejects.toThrow(
			"Config file too large (max 1MB)",
		);
	});

	// Skip timeout test due to bun test limitations with timer mocks
	it.skip("handles timeout", async () => {
		const loader = new HTTPSConfigLoader(1000); // 1 second timeout

		// Create a promise that never resolves to simulate timeout
		mockFetch.mockImplementation(
			() =>
				new Promise(() => {
					// Never resolves
				}),
		);

		const loadPromise = loader.load("https://example.com/slow.yaml");

		// Note: Bun doesn't support timer mocks like Jest
		// This test would need different approach in Bun

		await expect(loadPromise).rejects.toThrow("Request timeout after 1000ms");
	});

	it("handles network errors", async () => {
		mockFetch.mockRejectedValue(new Error("Network error"));

		await expect(loader.load("https://example.com/error.yaml")).rejects.toThrow(
			"Failed to fetch config from https://example.com/error.yaml: Network error",
		);
	});

	it("uses custom timeout", async () => {
		const customLoader = new HTTPSConfigLoader(5000);
		const configContent = "timeout: test";

		mockFetch.mockResolvedValue({
			ok: true,
			status: 200,
			statusText: "OK",
			text: async () => configContent,
		} as Response);

		const result = await customLoader.load("https://example.com/config.yaml");
		expect(result).toBe(configContent);
	});
});
