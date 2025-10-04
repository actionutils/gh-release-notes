import { describe, it, expect, beforeEach } from "@jest/globals";
import * as fs from "node:fs/promises";
import * as path from "node:path";
import { LocalConfigLoader } from "../local-config-loader";
import { mock } from "bun:test";

describe("LocalConfigLoader", () => {
	let loader: LocalConfigLoader;

	beforeEach(() => {
		loader = new LocalConfigLoader();
	});

	it("loads local file successfully", async () => {
		const configContent = "name: Test Config\nversion: 1.0";
		const mockReadFile = mock(() => Promise.resolve(configContent));
		(fs as any).readFile = mockReadFile;

		const result = await loader.load("./config.yaml");

		expect(result).toBe(configContent);
		expect(mockReadFile).toHaveBeenCalledWith(
			path.resolve(process.cwd(), "./config.yaml"),
			"utf-8",
		);
	});

	it("loads absolute path", async () => {
		const configContent = "test: data";
		const mockReadFile = mock(() => Promise.resolve(configContent));
		(fs as any).readFile = mockReadFile;

		const result = await loader.load("/absolute/path/config.json");

		expect(result).toBe(configContent);
		expect(mockReadFile).toHaveBeenCalledWith(
			path.resolve(process.cwd(), "/absolute/path/config.json"),
			"utf-8",
		);
	});

	it("throws error when file not found", async () => {
		const error = new Error("ENOENT: no such file or directory");
		(error as any).code = "ENOENT";
		const mockReadFile = mock(() => Promise.reject(error));
		(fs as any).readFile = mockReadFile;

		await expect(loader.load("./missing.yaml")).rejects.toThrow(
			"Config file not found:",
		);
	});

	it("throws error on read failure", async () => {
		const error = new Error("Permission denied");
		(error as any).code = "EACCES";
		const mockReadFile = mock(() => Promise.reject(error));
		(fs as any).readFile = mockReadFile;

		await expect(loader.load("./protected.yaml")).rejects.toThrow(
			"Failed to read config file: Permission denied",
		);
	});
});
