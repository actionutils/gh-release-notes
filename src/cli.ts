#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { run } from "./core";
import { setVerbose, logVerbose } from "./logger";
import { resolveBaseRepo } from "./repo-detector";

interface Args {
	repo?: string;
	config?: string;
	"prev-tag"?: string;
	tag?: string;
	target?: string;
	json: boolean;
	preview: boolean;
	verbose: boolean;
	"include-new-contributors"?: boolean;
	// Using enum instead of boolean to allow future extensibility
	// (e.g., fetching via HTML HEAD requests)
	"sponsor-fetch-mode"?: "none" | "graphql" | "html";
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
		.option("include-new-contributors", {
			type: "boolean",
			description:
				"Force include new contributors data (mainly for JSON output)",
			default: false,
		})
		.option("sponsor-fetch-mode", {
			type: "string",
			choices: ["none", "graphql", "html"] as const,
			description:
				"How to fetch sponsor information. 'graphql' requires user token (even without any permissions) - GitHub blocks app tokens including GITHUB_TOKEN from accessing this public data. 'html' (experimental) checks sponsor pages via HEAD requests.",
			default: "none",
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
			prevTag: args["prev-tag"],
			tag: args.tag,
			target: args.target,
			preview: args.preview,
			includeNewContributors: args["include-new-contributors"],
			sponsorFetchMode: args["sponsor-fetch-mode"],
		});

		if (args.json) {
			// Remove fields that don't make sense for this CLI's output
			// Unlike release-drafter, this tool doesn't create releases, so
			// fields like `draft` and `make_latest` are meaningless in --json output.
			// Allowlist only fields meaningful for consumers of this CLI
			// This avoids leaking release-creation specific or internal fields
			// from release-drafter internals (e.g., draft, make_latest, prerelease,
			// resolvedVersion, majorVersion, minorVersion, patchVersion, etc.).
			const {
				name,
				tag,
				body,
				targetCommitish: releaseTargetCommitish,
			} = result.release as any as Record<string, any>;
			const allowlistedRelease = {
				name,
				tag,
				body,
				targetCommitish: releaseTargetCommitish,
			} as Record<string, any>;

			// newContributors is a direct array aligned to contributors shape
			const shapedNewContributors = result.newContributors;

			logVerbose("[CLI] Output mode: JSON");
			process.stdout.write(
				JSON.stringify(
					{
						owner: result.owner,
						repo: result.repo,
						defaultBranch: result.defaultBranch,
						lastRelease: result.lastRelease,
						mergedPullRequests: result.pullRequests,
						categorizedPullRequests: result.categorizedPullRequests,
						contributors: result.contributors,
						newContributors: shapedNewContributors,
						release: allowlistedRelease,
					},
					null,
					2,
				) + "\n",
			);
		} else {
			logVerbose("[CLI] Output mode: Markdown body");
			process.stdout.write(String((result.release as any).body || "") + "\n");
		}
	} catch (e) {
		console.error("Error:", e);
		process.exit(1);
	}
}

void main();
