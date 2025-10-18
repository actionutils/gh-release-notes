import * as fs from "node:fs/promises";
import * as path from "node:path";
import yaml from "js-yaml";
import { DEFAULT_FALLBACK_CONFIG } from "../constants";

export interface InitOptions {
	output?: string; // path or '-' for stdout
	force?: boolean;
}

/**
 * Generate the default Release Drafter YAML with helpful comments.
 * The YAML portion is produced from DEFAULT_FALLBACK_CONFIG to ensure parity.
 */
export function generateInitConfigYaml(): string {
	const header = [
		"# Release Drafter configuration initialized by gh-release-notes",
		"# This config is compatible with Release Drafter and intended for use with gh-release-notes.",
		"# gh-release-notes: https://github.com/actionutils/gh-release-notes",
		"# Release Drafter: https://github.com/release-drafter/release-drafter",
		"# Add categories to group PRs, e.g.:",
		"# categories:",
		"#   - title: Features",
		"#     labels: [feature, enhancement]",
	].join("\n");

	// Dump in insertion order with stable formatting
	const body = yaml.dump(DEFAULT_FALLBACK_CONFIG, {
		indent: 2,
		lineWidth: -1,
		noRefs: true,
	});

	const footer = [
		'# exclude-labels: ["skip-changelog"]',
		'# include-labels: ["release-notes"]',
		'# exclude-contributors: ["dependabot[bot]"]',
	].join("\n");

	return `${header}\n${body}${footer}\n`;
}

/**
 * Initialize a Release Drafter config file.
 * - If output is '-' prints YAML to stdout and returns status 'printed'.
 * - Otherwise writes to the given path with safe overwrite semantics.
 */
export async function initCommand(opts: InitOptions = {}): Promise<
	| { status: "printed"; content: string }
	| {
			status: "created" | "overwrote" | "up-to-date";
			path: string;
			content: string;
	  }
> {
	const output =
		opts.output && opts.output.length > 0
			? opts.output
			: ".github/release-drafter.yml";
	const force = !!opts.force;

	const content = generateInitConfigYaml();

	if (output === "-") {
		// Print only
		return { status: "printed", content };
	}

	const outPath = path.resolve(output);
	const parent = path.dirname(outPath);

	// Ensure parent directory exists
	await fs.mkdir(parent, { recursive: true });

	// Determine overwrite semantics
	try {
		const existing = await fs.readFile(outPath, "utf8");
		if (existing === content) {
			return { status: "up-to-date", path: outPath, content };
		}
		if (!force) {
			throw new Error(
				`Refusing to overwrite existing file without --force: ${outPath}`,
			);
		}
		await fs.writeFile(outPath, content, "utf8");
		return { status: "overwrote", path: outPath, content };
	} catch (e: unknown) {
		// If error is because file doesn't exist, proceed to create
		const err = e as NodeJS.ErrnoException;
		if (err && err.code === "ENOENT") {
			await fs.writeFile(outPath, content, "utf8");
			return { status: "created", path: outPath, content };
		}
		// If it's the custom error above, rethrow
		throw e;
	}
}
