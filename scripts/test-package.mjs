import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

// Test the published shape without access to the checkout's node_modules.
const directory = await mkdtemp(
	path.join(tmpdir(), "gh-release-notes-package-"),
);
const originalDirectory = process.cwd();
const originalFetch = globalThis.fetch;
try {
	const packed = JSON.parse(
		execFileSync(
			"npm",
			["pack", "--ignore-scripts", "--json", "--pack-destination", directory],
			{ encoding: "utf8" },
		),
	)[0];
	const tarball = path.join(directory, packed.filename);
	execFileSync(
		"npm",
		["install", "--ignore-scripts", "--no-audit", "--no-fund", tarball],
		{ cwd: directory, stdio: "pipe" },
	);
	const packageDirectory = path.join(
		directory,
		"node_modules/@actionutils/gh-release-notes",
	);
	const manifest = JSON.parse(
		await readFile(path.join(packageDirectory, "package.json"), "utf8"),
	);
	const { run } = await import(
		pathToFileURL(path.join(packageDirectory, manifest.exports["."].import))
	);
	assert.equal(typeof run, "function");
	const typeCheck = path.join(directory, "consumer.mts");
	await writeFile(
		typeCheck,
		'import { run, type RunOptions } from "@actionutils/gh-release-notes";\nconst options: RunOptions = { repo: "acme/demo", configRef: "main" };\nvoid run(options);\n',
	);
	execFileSync(
		process.execPath,
		[
			path.join(originalDirectory, "node_modules/typescript/bin/tsc"),
			"--noEmit",
			"--strict",
			"--module",
			"nodenext",
			"--target",
			"es2022",
			typeCheck,
		],
		{ cwd: directory, stdio: "pipe" },
	);
	const version = execFileSync(
		process.execPath,
		[
			path.join(packageDirectory, manifest.bin["gh-release-notes"]),
			"--version",
		],
		{ encoding: "utf8", cwd: directory },
	);
	assert.equal(version.trim(), manifest.version);

	// Exercise the bundled WASM renderer, not just --help or an import.
	process.chdir(directory);
	await writeFile(
		"notes.jinja",
		"{{ owner }}/{{ repo }}: {{ mergedPullRequests | length }} PRs",
	);
	globalThis.fetch = async (input) => {
		const url = new URL(
			typeof input === "string" || input instanceof URL ? input : input.url,
		);
		let body;
		if (url.pathname === "/repos/acme/demo") body = { default_branch: "main" };
		else if (url.pathname === "/repos/acme/demo/releases") body = [];
		else if (url.pathname.includes("/git/matching-refs/")) body = [];
		else if (url.pathname === "/graphql")
			body = {
				data: {
					search: {
						nodes: [],
						pageInfo: { hasNextPage: false, endCursor: null },
					},
				},
			};
		else throw new Error(`Unexpected request: ${url}`);
		return new Response(JSON.stringify(body), {
			headers: { "content-type": "application/json" },
		});
	};
	const result = await run({
		repo: "acme/demo",
		token: "test-token",
		template: "notes.jinja",
		target: "main",
		skipNewContributors: true,
		sponsorFetchMode: "none",
	});
	assert.equal(result.release.body, "acme/demo: 0 PRs");
	console.log("Packed library, CLI, and WASM template rendering passed.");
} finally {
	globalThis.fetch = originalFetch;
	process.chdir(originalDirectory);
	await rm(directory, { recursive: true, force: true });
}
