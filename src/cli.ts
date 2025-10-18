#!/usr/bin/env node
import yargs from "yargs";
import { hideBin } from "yargs/helpers";
import { run } from "./core";
import { setVerbose, logVerbose } from "./logger";
import { resolveBaseRepo } from "./repo-detector";
import { initCommand } from "./commands/init";

async function main() {
	const parser = yargs(hideBin(process.argv))
		.scriptName("gh-release-notes")
		.usage("$0 <command> [options]")
		.command(
			"init",
			"Initialize a Release Drafter–style config",
			(cmd) =>
				cmd
					.option("output", {
						alias: "o",
						type: "string",
						description:
							"Output path (default: .github/release-drafter.yml). Use '-' for stdout.",
					})
					.option("force", {
						type: "boolean",
						description: "Overwrite the output file if it exists",
						default: false,
					}),
			async (argv) => {
				try {
					const res = await initCommand({
						output: argv.output as string | undefined,
						force: argv.force as boolean | undefined,
					});
					if (res.status === "printed") {
						process.stdout.write(res.content);
					} else {
						const msgMap = {
							created: "Created",
							overwrote: "Overwrote",
							"up-to-date": "Up-to-date",
						} as const;
						console.log(`${msgMap[res.status]}: ${res.path}`);
					}
				} catch (e) {
					console.error("Error:", e instanceof Error ? e.message : e);
					process.exit(1);
				}
			},
		)
		.command(
			"$0",
			"Generate release notes (default)",
			(cmd) =>
				cmd
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
						description:
							"Config source: local file, HTTPS URL, or purl (optional)",
						example:
							"pkg:github/release-drafter/release-drafter@v5#.github/release-drafter.yml",
					})
					.option("template", {
						alias: "t",
						type: "string",
						description:
							"MiniJinja template for release body. Template receives same data as --json output. Source: local file, HTTPS URL, or purl",
						example: "pkg:github/myorg/templates@v1.0.0#releases/default.jinja",
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
					}),
			async (args) => {
				// Set verbose mode if requested (timestamps included by default)
				setVerbose(!!args.verbose);

				logVerbose("[CLI] Verbose mode enabled");

				try {
					// Auto-detect repository if not provided
					let repoString = args.repo as string | undefined;
					if (!repoString) {
						const repo = await resolveBaseRepo({
							flagRepo: args.repo as string | undefined,
						});
						repoString = `${repo.owner}/${repo.name}`;
						logVerbose(`[CLI] Auto-detected repository: ${repoString}`);
					}

					logVerbose("[CLI] Starting run() with provided options");
					const result = await run({
						repo: repoString,
						config: args.config as string | undefined,
						template: args.template as string | undefined,
						prevTag: (args["prev-tag"] as string | undefined) ?? undefined,
						tag: args.tag as string | undefined,
						target: args.target as string | undefined,
						preview: !!args.preview,
						skipNewContributors: !!args["skip-new-contributors"],
						sponsorFetchMode:
							(args["sponsor-fetch-mode"] as
								| "none"
								| "graphql"
								| "html"
								| "auto"
								| undefined) ?? "auto",
						includeAllData: !!args.json || !!args.template,
					});

					// Display the output
					if (args.json) {
						process.stdout.write(JSON.stringify(result, null, 2) + "\n");
					} else {
						process.stdout.write(String(result.release.body || "") + "\n");
					}
				} catch (e) {
					console.error("Error:", e);
					process.exit(1);
				}
			},
		)
		.help("help")
		.alias("help", "h")
		.version(false)
		.example("$0", "Generate release notes for the latest changes")
		.example(
			"$0 --prev-tag v1.0.0 --tag v1.1.0",
			"Generate notes from v1.0.0 to v1.1.0",
		)
		.example(
			"$0 --config pkg:github/release-drafter/release-drafter@v5#.github/release-drafter.yml",
			"Use remote config from GitHub repository",
		)
		.example(
			"$0 --template pkg:github/myorg/templates@v1.0.0#releases/default.jinja",
			"Use remote MiniJinja template from GitHub",
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
				"Remote Config/Template Support:\n" +
				"  - Local file: ./config.yaml\n" +
				"  - HTTPS URL: https://example.com/config.yaml\n" +
				"  - GitHub purl: pkg:github/owner/repo@version#path/to/config.yaml\n" +
				"  - With checksum: pkg:github/owner/repo@version?checksum=sha256:abc123#config.yaml\n\n" +
				"MiniJinja Template Usage:\n" +
				"  Templates generate the release notes body using MiniJinja (https://github.com/mitsuhiko/minijinja).\n" +
				"  The template receives the same data structure as --json output.\n\n" +
				"  Example template:\n" +
				"    ## Release {{ release.tag }}\n" +
				"    ### ✨ Highlights\n" +
				"    {% for pr in mergedPullRequests %}\n" +
				"    {% if loop.index <= 5 %}\n" +
				"    - {{ pr.title }} (#{{ pr.number }})\n" +
				"    {% endif %}\n" +
				"    {% endfor %}\n" +
				"    \n" +
				"    **Full Changelog**: {{ fullChangelogLink }}\n\n" +
				"  Available data:\n" +
				"    - release: name, tag, targetCommitish, resolvedVersion, etc.\n" +
				"    - mergedPullRequests: array of all PRs with title, number, author, labels, etc.\n" +
				"    - categorizedPullRequests: PRs grouped by category\n" +
				"    - contributors: array of all contributors\n" +
				"    - newContributors: first-time contributors\n" +
				"    - owner, repo, defaultBranch, lastRelease, fullChangelogLink\n\n" +
				"More Information:\n" +
				"  GitHub: https://github.com/actionutils/gh-release-notes",
		)
		.strict()
		.wrap(100);

	await parser.parseAsync();
}

void main();
