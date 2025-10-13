#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { run } from "./core";
import { setVerbose, logVerbose } from "./logger";
import { resolveBaseRepo } from "./repo-detector";
import { TemplateRenderer } from "./template";

interface Args {
	repo?: string;
	config?: string;
	template?: string;
	"prev-tag"?: string;
	tag?: string;
	target?: string;
	json: boolean;
	preview: boolean;
	verbose: boolean;
	"skip-new-contributors"?: boolean;
	// Using enum instead of boolean to allow future extensibility
	// (e.g., fetching via HTML HEAD requests)
	"sponsor-fetch-mode"?: "none" | "graphql" | "html" | "auto";
}

async function main() {
	const parser = yargs(hideBin(process.argv))
		.scriptName("gh-release-notes")
		.usage("$0 [options]")
		.option("repo", {
			alias: "R",
			type: "string",
			description:
				"Repository in owner/repo format (auto-detected if not provided)",
			example: "octocat/Hello-World",
		})
		.option("config", {
			alias: "c",
			type: "string",
			description: "Config source: local file, HTTPS URL, or purl (optional)",
			example: ".github/release-drafter.yml",
		})
		.option("template", {
			alias: "t",
			type: "string",
			description: "Template source: local file, HTTPS URL, or purl (optional)",
			example: "release-notes.jinja",
		})
		.option("prev-tag", {
			type: "string",
			description:
				"Previous release tag to generate notes from (disables auto-detection)",
			example: "v1.0.0",
		})
		.option("tag", {
			type: "string",
			description: "New release tag",
			example: "v1.1.0",
		})
		.option("target", {
			type: "string",
			alias: "ref",
			description: "Target branch or commit SHA",
			example: "main",
		})
		.option("json", {
			type: "boolean",
			description: "Output in JSON format",
			default: false,
		})
		.option("preview", {
			type: "boolean",
			description:
				"Preview mode (uses target instead of tag for changelog comparison)",
			default: false,
		})
		.option("verbose", {
			alias: "v",
			type: "boolean",
			description: "Enable verbose logging",
			default: false,
		})
		.option("skip-new-contributors", {
			type: "boolean",
			description:
				"Skip fetching new contributors data to reduce API calls (only applies with --json or --template)",
			default: false,
		})
		.option("sponsor-fetch-mode", {
			type: "string",
			choices: ["none", "graphql", "html", "auto"] as const,
			description:
				"How to fetch sponsor information. 'graphql' requires non-GitHub App token (even without any permissions) - GitHub blocks GitHub App tokens (including GITHUB_TOKEN) from accessing this public data. 'html' (experimental) checks sponsor pages via HEAD requests. 'auto' automatically selects the best method based on token type.",
			default: "auto",
		})
		.help("help")
		.alias("help", "h")
		.version(false)
		.example("$0", "Generate release notes for the latest changes")
		.example(
			"$0 --prev-tag v1.0.0 --tag v1.1.0",
			"Generate notes from v1.0.0 to v1.1.0",
		)
		.example(
			"$0 --config .github/release-drafter.yml",
			"Use custom config file",
		)
		.example(
			"$0 --config pkg:github/myorg/.github#.github/release-notes.yaml",
			"Use remote config from GitHub",
		)
		.example(
			"$0 --template release.jinja --json",
			"Use minijinja template with JSON data",
		)
		.example(
			"$0 --preview --tag v2.0.0",
			"Preview release notes with changelog comparing to current target",
		)
		.example("$0 --json", "Output release notes in JSON format")
		.example("$0 --target feature-branch", "Generate notes for specific branch")
		.example("$0 -R octocat/Hello-World", "Specify repository explicitly")
		.epilogue(
			"Repository Detection:\n" +
				"  Automatically detects repository in the following order:\n" +
				"  1. --repo flag\n" +
				"  2. GITHUB_REPOSITORY env var (GitHub Actions)\n" +
				"  3. GH_REPO environment variable\n" +
				"  4. Current directory's git remotes\n\n" +
				"Authentication:\n" +
				"  Uses GitHub token in the following order:\n" +
				"  1. GITHUB_TOKEN environment variable\n" +
				"  2. GH_TOKEN environment variable\n" +
				"  3. gh auth token (from GitHub CLI)\n\n" +
				"Config File Format:\n" +
				"  Compatible with both:\n" +
				"  - Release-drafter: https://github.com/release-drafter/release-drafter\n" +
				"  - GitHub's release.yml: https://docs.github.com/en/repositories/releasing-projects-on-github/automatically-generated-release-notes\n\n" +
				"Remote Config Support:\n" +
				"  - Local file: ./config.yaml\n" +
				"  - HTTPS URL: https://example.com/config.yaml\n" +
				"  - GitHub purl: pkg:github/owner/repo@version#path/to/config.yaml\n" +
				"  - With checksum: pkg:github/owner/repo@v1.0?checksum=sha256:abc123#config.yaml\n\n" +
				"More Information:\n" +
				"  GitHub: https://github.com/actionutils/gh-release-notes",
		)
		.strict()
		.wrap(100);

	const args = (await parser.parseAsync()) as Args;

	// Set verbose mode if requested (timestamps included by default)
	setVerbose(args.verbose);

	logVerbose("[CLI] Verbose mode enabled");

	try {
		// Auto-detect repository if not provided
		let repoString = args.repo;
		if (!repoString) {
			const repo = await resolveBaseRepo({ flagRepo: args.repo });
			repoString = `${repo.owner}/${repo.name}`;
			logVerbose(`[CLI] Auto-detected repository: ${repoString}`);
		}

		logVerbose("[CLI] Starting run() with provided options");
		const result = await run({
			repo: repoString,
			config: args.config,
			template: args.template,
			prevTag: args["prev-tag"],
			tag: args.tag,
			target: args.target,
			preview: args.preview,
			includeNewContributors: (args.json || !!args.template) && !args["skip-new-contributors"],
			sponsorFetchMode: args["sponsor-fetch-mode"],
			isJsonMode: args.json || !!args.template,
		});

		// Prepare JSON data structure
		const allowlistedRelease = {
			name: result.release.name,
			tag: result.release.tag,
			body: result.release.body,
			targetCommitish: result.release.targetCommitish,
			resolvedVersion: result.release.resolvedVersion,
			majorVersion: result.release.majorVersion,
			minorVersion: result.release.minorVersion,
			patchVersion: result.release.patchVersion,
		};

		const shapedNewContributors = result.newContributors;

		const jsonData = {
			owner: result.owner,
			repo: result.repo,
			defaultBranch: result.defaultBranch,
			lastRelease: result.lastRelease,
			mergedPullRequests: result.pullRequests,
			categorizedPullRequests: result.categorizedPullRequests,
			contributors: result.contributors,
			newContributors: shapedNewContributors,
			release: allowlistedRelease,
			fullChangelogLink: result.fullChangelogLink,
		};

		if (args.template) {
			// Use template rendering
			logVerbose("[CLI] Output mode: Template rendering");
			const renderer = new TemplateRenderer(result.githubToken);
			const rendered = await renderer.loadAndRender(args.template, jsonData);
			process.stdout.write(rendered + "\n");
		} else if (args.json) {
			// Output JSON format
			logVerbose("[CLI] Output mode: JSON");
			process.stdout.write(JSON.stringify(jsonData, null, 2) + "\n");
		} else {
			// Output markdown body
			logVerbose("[CLI] Output mode: Markdown body");
			process.stdout.write(String((result.release as any).body || "") + "\n");
		}
	} catch (e) {
		console.error("Error:", e);
		process.exit(1);
	}
}

void main();
