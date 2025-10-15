import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ContentLoaderFactory } from "../src/content-loader/index";
import { LocalContentLoader } from "../src/content-loader/local-content-loader";

describe("ContentLoader Integration Tests", () => {
	describe("LocalContentLoader", () => {
		it("loads a real local file", async () => {
			// Create a temp file
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
			const configPath = path.join(tmpDir, "test.yaml");
			const content = "test: config\nversion: 1.0";
			await fs.writeFile(configPath, content);

			const loader = new LocalContentLoader();
			const result = await loader.load(configPath);

			expect(result).toBe(content);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		it("handles non-existent file", async () => {
			const loader = new LocalContentLoader();
			await expect(
				loader.load("/non-existent/path/config.yaml"),
			).rejects.toThrow("Content file not found");
		});
	});

	describe("ContentLoaderFactory", () => {
		it("detects and loads local file", async () => {
			// Create a temp file
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
			const configPath = path.join(tmpDir, "factory-test.json");
			const content = '{"name": "factory test"}';
			await fs.writeFile(configPath, content);

			const factory = new ContentLoaderFactory();
			const result = await factory.load(configPath);

			expect(result).toBe(content);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		it("rejects HTTP URLs (not HTTPS)", async () => {
			const factory = new ContentLoaderFactory();
			// HTTP is treated as local file, which will fail
			await expect(factory.load("http://example.com/config")).rejects.toThrow();
		});

		it("throws when purl is used without token", async () => {
			const factory = new ContentLoaderFactory();
			await expect(factory.load("pkg:github/owner/repo#file.yaml")).rejects.toThrow(
				"GitHub token required for purl content",
			);
		});

		it("handles purl without subpath when token provided", async () => {
			const factory = new ContentLoaderFactory("test-token");
			await expect(factory.load("pkg:github/owner/repo")).rejects.toThrow(
				"purl must include a subpath",
			);
		});

		it("handles non-github purl when token provided", async () => {
			const factory = new ContentLoaderFactory("test-token");
			await expect(factory.load("pkg:npm/package#file")).rejects.toThrow(
				"Unsupported purl type: npm",
			);
		});
	});
});
