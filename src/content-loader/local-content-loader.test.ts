import { describe, test, expect } from "bun:test";
import * as path from "node:path";
import * as os from "node:os";
import * as fs from "node:fs/promises";
import { LocalContentLoader } from "./local-content-loader";

describe("LocalContentLoader", () => {
	describe("Unit tests with real files", () => {
		test("loads local file successfully", async () => {
			// Create a real temp file
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-"));
			const contentPath = path.join(tmpDir, "content.yaml");
			const contentContent = "name: Test Config\nversion: 1.0";
			await fs.writeFile(contentPath, contentContent);

			const loader = new LocalContentLoader();
			const result = await loader.load(contentPath);

			expect(result).toBe(contentContent);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		test("loads absolute path", async () => {
			// Create a real temp file with absolute path
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-abs-"));
			const contentPath = path.join(tmpDir, "content.json");
			const contentContent = '{"test": "data"}';
			await fs.writeFile(contentPath, contentContent);

			const loader = new LocalContentLoader();
			const result = await loader.load(contentPath);

			expect(result).toBe(contentContent);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		test("throws error when file not found", async () => {
			const loader = new LocalContentLoader();
			const nonExistentPath = path.join(
				os.tmpdir(),
				"non-existent-" + Date.now() + ".yaml",
			);

			expect(loader.load(nonExistentPath)).rejects.toThrow(
				"Content file not found:",
			);
		});

		test("throws error on read failure (directory instead of file)", async () => {
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-dir-"));

			const loader = new LocalContentLoader();

			// Try to read a directory as a file
			expect(loader.load(tmpDir)).rejects.toThrow(
				"Failed to read content file:",
			);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});
	});

	describe("Edge cases", () => {
		test("handles relative paths correctly", async () => {
			// Create a temp file in current directory
			const filename = `test-content-${Date.now()}.yaml`;
			const contentContent = "relative: test";
			await fs.writeFile(filename, contentContent);

			const loader = new LocalContentLoader();
			const result = await loader.load(`./${filename}`);

			expect(result).toBe(contentContent);

			// Cleanup
			await fs.unlink(filename);
		});

		test("handles empty file", async () => {
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-empty-"));
			const contentPath = path.join(tmpDir, "empty.yaml");
			await fs.writeFile(contentPath, "");

			const loader = new LocalContentLoader();
			const result = await loader.load(contentPath);

			expect(result).toBe("");

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});

		test("handles large file", async () => {
			const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "test-large-"));
			const contentPath = path.join(tmpDir, "large.yaml");
			const largeContent = "x".repeat(10000); // 10KB file
			await fs.writeFile(contentPath, largeContent);

			const loader = new LocalContentLoader();
			const result = await loader.load(contentPath);

			expect(result).toBe(largeContent);

			// Cleanup
			await fs.rm(tmpDir, { recursive: true });
		});
	});
});
