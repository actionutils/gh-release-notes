import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import * as os from "node:os";
import { ConfigLoaderFactory } from "../src/config-loader/index";
import { LocalConfigLoader } from "../src/config-loader/local-config-loader";

describe("ConfigLoader Integration Tests", () => {
	describe("LocalConfigLoader", () => {
		it("loads a real local file", async () => {
			// Create a temp file
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
			const configPath = path.join(tmpDir, "test.yaml");
			const content = "test: config\nversion: 1.0";
			await fs.writeFile(configPath, content);

			const loader = new LocalConfigLoader();
			const result = await loader.load(configPath);

			expect(result).toBe(content);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		it("handles non-existent file", async () => {
			const loader = new LocalConfigLoader();
			await expect(
				loader.load("/non-existent/path/config.yaml"),
			).rejects.toThrow("Config file not found");
		});
	});

	describe("ConfigLoaderFactory", () => {
		it("detects and loads local file", async () => {
			// Create a temp file
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "config-test-"));
			const configPath = path.join(tmpDir, "factory-test.json");
			const content = '{"name": "factory test"}';
			await fs.writeFile(configPath, content);

			const factory = new ConfigLoaderFactory();
			const result = await factory.load(configPath);

			expect(result).toBe(content);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		it("rejects HTTP URLs (not HTTPS)", async () => {
			const factory = new ConfigLoaderFactory();
			// HTTP is treated as local file, which will fail
			await expect(factory.load("http://example.com/config")).rejects.toThrow();
		});

		it("throws when purl is used without token", async () => {
			const factory = new ConfigLoaderFactory();
			await expect(factory.load("pkg:github/owner/repo#file.yaml")).rejects.toThrow(
				"GitHub token required for purl configs",
			);
		});

		it("handles purl without subpath when token provided", async () => {
			const factory = new ConfigLoaderFactory("test-token");
			await expect(factory.load("pkg:github/owner/repo")).rejects.toThrow(
				"purl must include a subpath",
			);
		});

		it("handles non-github purl when token provided", async () => {
			const factory = new ConfigLoaderFactory("test-token");
			await expect(factory.load("pkg:npm/package#file")).rejects.toThrow(
				"Unsupported purl type: npm",
			);
		});
	});
});
