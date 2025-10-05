import { describe, test, expect } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { LocalConfigLoader } from "./local-config-loader";

describe("LocalConfigLoader", () => {
	describe("Unit tests with real files", () => {
		test("loads local file successfully", async () => {
			// Create a real temp file
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"));
			const configPath = path.join(tmpDir, "config.yaml");
			const configContent = "name: Test Config\nversion: 1.0";
			await fs.writeFile(configPath, configContent);

			const loader = new LocalConfigLoader();
			const result = await loader.load(configPath);

			expect(result).toBe(configContent);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		test("loads absolute path", async () => {
			// Create a real temp file with absolute path
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-abs-"));
			const configPath = path.join(tmpDir, "config.json");
			const configContent = '{"test": "data"}';
			await fs.writeFile(configPath, configContent);

			const loader = new LocalConfigLoader();
			const result = await loader.load(configPath);

			expect(result).toBe(configContent);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		test("throws error when file not found", async () => {
			const loader = new LocalConfigLoader();
			const nonExistentPath = path.join(
				os.tmpdir(),
				"non-existent-" + Date.now() + ".yaml",
			);

			expect(loader.load(nonExistentPath)).rejects.toThrow(
				"Config file not found:",
			);
		});

		test("throws error on read failure (directory instead of file)", async () => {
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-dir-"));

			const loader = new LocalConfigLoader();

			// Try to read a directory as a file
			expect(loader.load(tmpDir)).rejects.toThrow(
				"Failed to read config file:",
			);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});
	});

	describe("Edge cases", () => {
		test("handles relative paths correctly", async () => {
			// Create a temp file in current directory
			const filename = `test-config-${Date.now()}.yaml`;
			const configContent = "relative: test";
			await fs.writeFile(filename, configContent);

			const loader = new LocalConfigLoader();
			const result = await loader.load(`./${filename}`);

			expect(result).toBe(configContent);

			// Cleanup
			await fs.unlink(filename);
		});

		test("handles empty file", async () => {
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-empty-"));
			const configPath = path.join(tmpDir, "empty.yaml");
			await fs.writeFile(configPath, "");

			const loader = new LocalConfigLoader();
			const result = await loader.load(configPath);

			expect(result).toBe("");

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		test("handles large file", async () => {
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-large-"));
			const configPath = path.join(tmpDir, "large.yaml");
			const largeContent = "x".repeat(10000); // 10KB file
			await fs.writeFile(configPath, largeContent);

			const loader = new LocalConfigLoader();
			const result = await loader.load(configPath);

			expect(result).toBe(largeContent);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});
	});
});
