import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import {
	convertGitHubToReleaseDrafter,
	isGitHubReleaseConfig,
} from "../github-config-converter";
import { migrateCommand } from "./migrate";

async function mkTmpDir(prefix: string): Promise<string> {
	return await fs.mkdtemp(path.join(os.tmpdir(), prefix));
}

describe("migrate command", () => {
	const originalCwd = process.cwd();
	let tmpDir: string;

	beforeEach(async () => {
		tmpDir = await mkTmpDir("ghrn-migrate-");
	});

	afterEach(async () => {
		process.chdir(originalCwd);
		await fs.rm(tmpDir, { recursive: true, force: true });
	});

	it("migrates GitHub release.yml to release-drafter.yml by default detection", async () => {
		const ghDir = path.join(tmpDir, ".github");
		await fs.mkdir(ghDir, { recursive: true });
		const sourcePath = path.join(ghDir, "release.yml");
		const githubConfig = {
			changelog: {
				exclude: { labels: ["skip"], authors: ["bot"] },
				categories: [
					{ title: "Features", labels: ["feature"] },
					{ title: "Other", labels: ["*"] },
				],
			},
		};
		await fs.writeFile(sourcePath, yaml.dump(githubConfig) + "\n", "utf8");

		process.chdir(tmpDir);
		const res = await migrateCommand({});
		expect(["created", "overwrote", "up-to-date"]).toContain(res.status);
		if (
			res.status === "created" ||
			res.status === "overwrote" ||
			res.status === "up-to-date"
		) {
			expect(res.path!).toMatch(/\.github\/release-drafter\.yml$/);
			const disk = await fs.readFile(res.path!, "utf8");
			// Header should include links
			expect(disk).toContain("https://github.com/actionutils/gh-release-notes");
			expect(disk).toContain(
				"https://github.com/release-drafter/release-drafter",
			);
			// YAML should parse to expected content
			const expectedObj = convertGitHubToReleaseDrafter(githubConfig);
			const parsed = yaml.load(disk) as unknown;
			expect(parsed).toEqual(expectedObj);
			// Wildcard exclude warning isn't present here; no per-category exclude provided
			expect(res.warnings.length).toBe(0);
		}
	});

	it("prints to stdout when output is '-'", async () => {
		const ghDir = path.join(tmpDir, ".github");
		await fs.mkdir(ghDir, { recursive: true });
		const sourcePath = path.join(ghDir, "release.yaml");
		const githubConfig = {
			changelog: {
				categories: [
					{ title: "Cat", labels: ["*"] },
					{ title: "Libs", labels: ["deps"], exclude: { labels: ["skip"] } },
				],
			},
		};
		await fs.writeFile(sourcePath, yaml.dump(githubConfig) + "\n", "utf8");
		process.chdir(tmpDir);

		const res = await migrateCommand({ output: "-" });
		expect(res.status).toBe("printed");
		if (res.status === "printed") {
			// Header should include links
			expect(res.content).toContain(
				"https://github.com/actionutils/gh-release-notes",
			);
			expect(res.content).toContain(
				"https://github.com/release-drafter/release-drafter",
			);
			const expectedObj = convertGitHubToReleaseDrafter(githubConfig);
			const parsed = yaml.load(res.content) as unknown;
			expect(parsed).toEqual(expectedObj);
			// Should have a warning for per-category exclude
			expect(res.warnings.length).toBe(1);
			expect(res.warnings[0]).toContain("per-category excludes");
		}
	});

	it("returns nothing-to-migrate when source is already release-drafter config and no output is specified", async () => {
		const ghDir = path.join(tmpDir, ".github");
		await fs.mkdir(ghDir, { recursive: true });
		const sourcePath = path.join(ghDir, "release.yml");
		const rdConfig = {
			template: "Hello\n$CHANGES\n",
			categories: [{ title: "Docs", labels: ["docs"] }],
		};
		// Sanity: ensure it's not detected as GitHub release config
		expect(isGitHubReleaseConfig(rdConfig as unknown)).toBe(false);
		await fs.writeFile(sourcePath, yaml.dump(rdConfig) + "\n", "utf8");
		process.chdir(tmpDir);

		const res = await migrateCommand({});
		expect(res.status).toBe("nothing-to-migrate");
	});

	it("refuses to overwrite output without --force and overwrites with --force", async () => {
		const ghDir = path.join(tmpDir, ".github");
		await fs.mkdir(ghDir, { recursive: true });
		const sourcePath = path.join(ghDir, "release.yml");
		const githubConfig = { changelog: {} };
		await fs.writeFile(sourcePath, yaml.dump(githubConfig) + "\n", "utf8");
		process.chdir(tmpDir);

		const first = await migrateCommand({});
		expect(first.status).toBe("created");

		const outPath = path.join(tmpDir, ".github", "release-drafter.yml");
		await fs.writeFile(outPath, "different: true\n", "utf8");

		// Expect rejection without force using try/catch to satisfy linter
		let threw = false;
		try {
			await migrateCommand({});
		} catch (e) {
			threw = true;
			expect(String(e)).toContain("Refusing to overwrite existing file");
		}
		expect(threw).toBe(true);

		const forced = await migrateCommand({ force: true });
		expect(forced.status).toBe("overwrote");
	});

	it("errors when no source is found", async () => {
		process.chdir(tmpDir);
		return expect(migrateCommand({})).rejects.toThrow(
			"No source release config found",
		);
	});
});
