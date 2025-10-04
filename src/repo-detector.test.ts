import { describe, it, expect, beforeEach, afterEach } from "bun:test";
import {
	parseRepoRef,
	normalizeGitURL,
	remoteScore,
	type Repo,
} from "./repo-detector";

describe("parseRepoRef", () => {
	const defaultHost = "github.com";

	it("should parse OWNER/REPO format", () => {
		const result = parseRepoRef("octocat/Hello-World", defaultHost);
		expect(result).toEqual({
			host: "github.com",
			owner: "octocat",
			name: "Hello-World",
		});
	});

	it("should parse HOST/OWNER/REPO format", () => {
		const result = parseRepoRef("ghe.example.com/enterprise/app", defaultHost);
		expect(result).toEqual({
			host: "ghe.example.com",
			owner: "enterprise",
			name: "app",
		});
	});

	it("should parse HTTPS URLs", () => {
		const result = parseRepoRef(
			"https://github.com/actionutils/gh-release-notes.git",
			defaultHost,
		);
		expect(result).toEqual({
			host: "github.com",
			owner: "actionutils",
			name: "gh-release-notes",
		});
	});

	it("should parse HTTPS URLs without .git", () => {
		const result = parseRepoRef(
			"https://github.com/actionutils/gh-release-notes",
			defaultHost,
		);
		expect(result).toEqual({
			host: "github.com",
			owner: "actionutils",
			name: "gh-release-notes",
		});
	});

	it("should parse SSH URLs", () => {
		const result = parseRepoRef(
			"git@github.com:actionutils/gh-release-notes.git",
			defaultHost,
		);
		expect(result).toEqual({
			host: "github.com",
			owner: "actionutils",
			name: "gh-release-notes",
		});
	});

	it("should normalize hosts (lowercase)", () => {
		const result = parseRepoRef(
			"https://GITHUB.COM/owner/repo",
			defaultHost,
		);
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});

	it("should return null for invalid formats", () => {
		expect(parseRepoRef("", defaultHost)).toBeNull();
		expect(parseRepoRef("just-a-name", defaultHost)).toBeNull();
		expect(parseRepoRef("too/many/slashes/here", defaultHost)).toBeNull();
	});

	it("should strip .git suffix from repo names", () => {
		const result = parseRepoRef("owner/repo.git", defaultHost);
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});
});

describe("normalizeGitURL", () => {
	it("should normalize HTTPS URLs", () => {
		const result = normalizeGitURL("https://github.com/owner/repo.git");
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});

	it("should normalize SSH URLs", () => {
		const result = normalizeGitURL("git@github.com:owner/repo.git");
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});

	it("should normalize SSH URLs with ssh:// prefix", () => {
		const result = normalizeGitURL("ssh://git@github.com/owner/repo.git");
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});

	it("should handle URLs without .git suffix", () => {
		const result = normalizeGitURL("https://github.com/owner/repo");
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});

	it("should normalize host (lowercase, remove port)", () => {
		const result = normalizeGitURL("https://GITHUB.COM:443/owner/repo");
		expect(result).toEqual({
			host: "github.com",
			owner: "owner",
			name: "repo",
		});
	});

	it("should return null for invalid URLs", () => {
		expect(normalizeGitURL("not-a-url")).toBeNull();
		expect(normalizeGitURL("https://github.com")).toBeNull();
		expect(normalizeGitURL("https://github.com/owner")).toBeNull();
	});
});

describe("remoteScore", () => {
	it("should prioritize upstream", () => {
		expect(remoteScore("upstream")).toBe(3);
		expect(remoteScore("UPSTREAM")).toBe(3);
		expect(remoteScore("Upstream")).toBe(3);
	});

	it("should prioritize github", () => {
		expect(remoteScore("github")).toBe(2);
		expect(remoteScore("GITHUB")).toBe(2);
		expect(remoteScore("GitHub")).toBe(2);
	});

	it("should prioritize origin", () => {
		expect(remoteScore("origin")).toBe(1);
		expect(remoteScore("ORIGIN")).toBe(1);
		expect(remoteScore("Origin")).toBe(1);
	});

	it("should give zero score to other remotes", () => {
		expect(remoteScore("fork")).toBe(0);
		expect(remoteScore("my-remote")).toBe(0);
		expect(remoteScore("backup")).toBe(0);
	});
});

describe("Environment variable parsing", () => {
	let originalEnv: NodeJS.ProcessEnv;

	beforeEach(() => {
		originalEnv = { ...process.env };
	});

	afterEach(() => {
		process.env = originalEnv;
	});

	it("should handle GITHUB_REPOSITORY format", () => {
		// This would be tested in integration tests
		// as it requires the full resolveBaseRepo function
		const result = parseRepoRef("actionutils/gh-release-notes", "github.com");
		expect(result).toEqual({
			host: "github.com",
			owner: "actionutils",
			name: "gh-release-notes",
		});
	});

	it("should handle GH_REPO format with host", () => {
		const result = parseRepoRef("ghe.example.com/owner/repo", "github.com");
		expect(result).toEqual({
			host: "ghe.example.com",
			owner: "owner",
			name: "repo",
		});
	});
});
