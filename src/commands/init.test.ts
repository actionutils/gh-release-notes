import { describe, it, expect } from "bun:test";
import * as fs from "node:fs/promises";
import * as os from "node:os";
import * as path from "node:path";
import yaml from "js-yaml";
import { DEFAULT_FALLBACK_CONFIG } from "../constants";
import { generateInitConfigYaml, initCommand } from "./init";

describe("init command", () => {
	it("generates YAML matching DEFAULT_FALLBACK_CONFIG and includes comments", () => {
		const out = generateInitConfigYaml();

		// YAML should include guiding comments
		expect(out).toContain(
			"# Release Drafter configuration initialized by gh-release-notes",
		);
		expect(out).toContain("# categories:");
		expect(out).toContain('# exclude-labels: ["skip-changelog"]');
		expect(out).toContain('# include-labels: ["release-notes"]');
		expect(out).toContain('# exclude-contributors: ["dependabot[bot]"]');

		// Parsing should yield the default config exactly
		const parsed = yaml.load(out) as Record<string, unknown>;
		expect(parsed).toEqual(DEFAULT_FALLBACK_CONFIG);
	});

	it("prints to stdout when output is '-'", async () => {
		const res = await initCommand({ output: "-" });
		expect(res.status).toBe("printed");
		if (res.status === "printed") {
			const parsed = yaml.load(res.content) as Record<string, unknown>;
			expect(parsed).toEqual(DEFAULT_FALLBACK_CONFIG);
		}
	});

	it("creates a new file when none exists", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ghrn-init-"));
		const outPath = path.join(tmpDir, "release-drafter.yml");

		const res = await initCommand({ output: outPath });
		expect(res.status).toBe("created");
		if (res.status !== "created") throw new Error("unexpected state");

		const disk = await fs.readFile(outPath, "utf8");
		expect(disk).toBe(res.content);

		const parsed = yaml.load(disk) as Record<string, unknown>;
		expect(parsed).toEqual(DEFAULT_FALLBACK_CONFIG);

		await fs.rm(tmpDir, { recursive: true });
	});

	it("short-circuits as up-to-date when content matches", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ghrn-init-"));
		const outPath = path.join(tmpDir, "release-drafter.yml");

		const first = await initCommand({ output: outPath });
		expect(first.status).toBe("created");

		const second = await initCommand({ output: outPath });
		expect(second.status).toBe("up-to-date");

		await fs.rm(tmpDir, { recursive: true });
	});

	it("refuses to overwrite without --force and overwrites with --force", async () => {
		const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "ghrn-init-"));
		const outPath = path.join(tmpDir, "release-drafter.yml");

		await initCommand({ output: outPath });
		// Write different content
		await fs.writeFile(outPath, "different: true\n", "utf8");

		// Return the Promise for reject assertion to satisfy linting rules
		return expect(initCommand({ output: outPath })).rejects.toThrow(
			"Refusing to overwrite existing file",
		);

		const forced = await initCommand({ output: outPath, force: true });
		expect(forced.status).toBe("overwrote");

		const disk = await fs.readFile(outPath, "utf8");
		const parsed = yaml.load(disk) as Record<string, unknown>;
		expect(parsed).toEqual(DEFAULT_FALLBACK_CONFIG);

		await fs.rm(tmpDir, { recursive: true });
	});
});
