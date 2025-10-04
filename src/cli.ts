#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { run } from "./core";
import { setVerbose } from "./logger";

interface Args {
	repo: string;
	config?: string;
	"prev-tag"?: string;
	tag?: string;
	target?: string;
	json: boolean;
	preview: boolean;
	verbose: boolean;
}

async function main() {
	const parser = yargs(hideBin(process.argv))
		.scriptName("gh-release-notes")
		.usage("$0 --repo <owner/repo> [options]")
		.option("repo", {
			alias: "r",
			type: "string",
			description: "Repository in owner/repo format",
			demandOption: true,
			example: "octocat/Hello-World",
		})
		.option("config", {
			alias: "c",
			type: "string",
			description: "Path to release-drafter config file (optional)",
			example: ".github/release-drafter.yml",
		})
		.option("prev-tag", {
			type: "string",
			description: "Previous release tag to generate notes from (disables auto-detection)",
			example: "v1.0.0",
		})
		.option("tag", {
			type: "string",
			description: "New release tag (for preview mode)",
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
			description: "Preview mode (don't create actual release)",
			default: false,
		})
		.option("verbose", {
			alias: "v",
			type: "boolean",
			description: "Enable verbose logging",
			default: false,
		})
		.help("help")
		.alias("help", "h")
		.version(false)
		.example(
			"$0 --repo octocat/Hello-World",
			"Generate release notes for the latest changes",
		)
		.example(
			"$0 --repo octocat/Hello-World --prev-tag v1.0.0 --tag v1.1.0",
			"Generate notes from v1.0.0 to v1.1.0",
		)
		.example(
			"$0 --repo octocat/Hello-World --config .github/release-drafter.yml",
			"Use custom config file",
		)
		.example(
			"$0 --repo octocat/Hello-World --preview --tag v2.0.0",
			"Preview release notes for v2.0.0 without creating release",
		)
		.example(
			"$0 --repo octocat/Hello-World --json",
			"Output release notes in JSON format",
		)
		.example(
			"$0 --repo octocat/Hello-World --target feature-branch",
			"Generate notes for specific branch",
		)
		.epilogue(
			"Authentication:\n" +
				"  Uses GitHub token in the following order:\n" +
				"  1. GITHUB_TOKEN environment variable\n" +
				"  2. GH_TOKEN environment variable\n" +
				"  3. gh auth token (from GitHub CLI)\n\n" +
				"Config File Format:\n" +
				"  Compatible with release-drafter configuration format.\n" +
				"  See: https://github.com/release-drafter/release-drafter\n\n" +
				"More Information:\n" +
				"  GitHub: https://github.com/actionutils/gh-release-notes",
		)
		.strict()
		.wrap(100);

	const args = (await parser.parseAsync()) as Args;

	// Set verbose mode if requested
	setVerbose(args.verbose);

	try {
		const result = await run({
			repo: args.repo,
			config: args.config,
			prevTag: args["prev-tag"],
			tag: args.tag,
			target: args.target,
			preview: args.preview,
		});

		if (args.json) {
			process.stdout.write(
				JSON.stringify(
					{
						owner: result.owner,
						repo: result.repo,
						defaultBranch: result.defaultBranch,
						targetCommitish: result.targetCommitish,
						lastRelease: result.lastRelease,
						mergedPullRequests: result.pullRequests,
						release: result.release,
					},
					null,
					2,
				) + "\n",
			);
		} else {
			process.stdout.write(String((result.release as any).body || "") + "\n");
		}
	} catch (e) {
		console.error("Error:", e);
		process.exit(1);
	}
}

void main();
