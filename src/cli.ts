#!/usr/bin/env node
import { run } from "./core";
import { setVerbose } from "./logger";

type Args = {
	repo?: string;
	config?: string;
	prevTag?: string;
	tag?: string;
	autoPrev?: boolean;
	target?: string;
	json: boolean;
	preview: boolean;
	verbose: boolean;
};

function usage(msg?: string) {
	if (msg) console.error(msg);
	console.error(`
Usage:
  gh-release-notes --repo owner/repo [--config config.yml] [--target REF] [--prev-tag TAG | --auto-prev] [--tag NEW_TAG] [--json] [--preview] [--verbose]

Env:
  GITHUB_TOKEN or GH_TOKEN must be set.
`);
	process.exit(msg ? 1 : 0);
}

function parseArgs(argv: string[]): Args {
	const args: Args = {
		autoPrev: true,
		json: false,
		preview: false,
		verbose: false,
	};
	for (let i = 2; i < argv.length; i++) {
		const a = argv[i];
		switch (a) {
			case "--repo":
			case "-r":
				args.repo = argv[++i];
				break;
			case "--config":
			case "-c":
				args.config = argv[++i];
				break;
			case "--prev-tag":
				args.prevTag = argv[++i];
				args.autoPrev = false;
				break;
			case "--tag":
				args.tag = argv[++i];
				break;
			case "--auto-prev":
				args.autoPrev = true;
				break;
			case "--target":
			case "--ref":
				args.target = argv[++i];
				break;
			case "--json":
				args.json = true;
				break;
			case "--preview":
				args.preview = true;
				break;
			case "--verbose":
			case "-v":
				args.verbose = true;
				break;
			case "--help":
			case "-h":
				args.autoPrev = true;
				usage();
		}
	}
	return args;
}

async function main() {
	const args = parseArgs(process.argv);
	if (!args.repo) usage("Missing --repo");
	// config is optional; default will be used if not provided

	// Set verbose mode if requested
	setVerbose(args.verbose);

	const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
	try {
		const result = await run({
			repo: args.repo!,
			config: args.config,
			prevTag: args.prevTag,
			tag: args.tag,
			target: args.target,
			token: token!,
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
