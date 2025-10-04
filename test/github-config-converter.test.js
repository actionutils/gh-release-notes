const {
	isGitHubReleaseConfig,
	convertGitHubToReleaseDrafter,
	normalizeConfig,
} = require("../src/github-config-converter.ts");

describe("GitHub Config Converter", () => {
	describe("isGitHubReleaseConfig", () => {
		it("should detect GitHub release.yml format", () => {
			const githubConfig = {
				changelog: {
					categories: [
						{
							title: "Features",
							labels: ["feature"],
						},
					],
				},
			};
			expect(isGitHubReleaseConfig(githubConfig)).toBe(true);
		});

		it("should not detect release-drafter format as GitHub format", () => {
			const releaseDrafterConfig = {
				template: "## What's Changed\n\n$CHANGES",
				categories: [
					{
						title: "Features",
						labels: ["feature"],
					},
				],
			};
			expect(isGitHubReleaseConfig(releaseDrafterConfig)).toBe(false);
		});

		it("should handle invalid configs", () => {
			expect(isGitHubReleaseConfig(null)).toBe(false);
			expect(isGitHubReleaseConfig(undefined)).toBe(false);
			expect(isGitHubReleaseConfig({})).toBe(false);
		});

		it("should detect GitHub format with only exclude section", () => {
			const githubConfig = {
				changelog: {
					exclude: {
						labels: ["ignore"],
					},
				},
			};
			expect(isGitHubReleaseConfig(githubConfig)).toBe(true);
		});

		it("should detect GitHub format with empty changelog", () => {
			const githubConfig = {
				changelog: {},
			};
			expect(isGitHubReleaseConfig(githubConfig)).toBe(true);
		});
	});

	describe("convertGitHubToReleaseDrafter", () => {
		it("should convert basic categories", () => {
			const githubConfig = {
				changelog: {
					categories: [
						{
							title: "🚀 Features",
							labels: ["feature", "enhancement"],
						},
						{
							title: "🐛 Bug Fixes",
							labels: ["bug", "bugfix"],
						},
					],
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			expect(result.categories).toEqual([
				{
					title: "🚀 Features",
					labels: ["feature", "enhancement"],
				},
				{
					title: "🐛 Bug Fixes",
					labels: ["bug", "bugfix"],
				},
			]);
		});

		it("should convert excluded labels", () => {
			const githubConfig = {
				changelog: {
					exclude: {
						labels: ["ignore-for-release", "skip"],
					},
					categories: [],
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			expect(result["exclude-labels"]).toEqual([
				"ignore-for-release",
				"skip",
			]);
		});

		it("should convert excluded authors", () => {
			const githubConfig = {
				changelog: {
					exclude: {
						authors: ["dependabot", "bot-user"],
					},
					categories: [],
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			expect(result["exclude-contributors"]).toEqual([
				"dependabot",
				"bot-user",
			]);
		});

		it("should handle wildcard category", () => {
			const githubConfig = {
				changelog: {
					categories: [
						{
							title: "Other Changes",
							labels: ["*"],
						},
					],
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			// Wildcard categories should have no labels property
			// (release-drafter treats this as uncategorized)
			expect(result.categories).toEqual([
				{
					title: "Other Changes",
				},
			]);
		});

		it("should handle complex example from GitHub docs", () => {
			const githubConfig = {
				changelog: {
					exclude: {
						labels: ["ignore-for-release", "release-pr"],
					},
					categories: [
						{
							title: "Breaking Changes 🛠",
							labels: ["breaking-change"],
						},
						{
							title: "Deprecations ⚠️",
							labels: ["deprecation"],
						},
						{
							title: "Enhancements 🎉",
							labels: ["enhancement"],
						},
						{
							title: "Bug Fixes 🐛",
							labels: ["bug"],
						},
						{
							title: "Other Changes",
							labels: ["*"],
							exclude: {
								labels: ["dependencies"],
							},
						},
						{
							title: "Dependencies",
							labels: ["dependencies"],
						},
					],
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			expect(result["exclude-labels"]).toEqual([
				"ignore-for-release",
				"release-pr",
			]);
			expect(result.categories).toBeDefined();
			expect(result.categories.length).toBe(6);
			expect(result.categories[0]).toEqual({
				title: "Breaking Changes 🛠",
				labels: ["breaking-change"],
			});
			// Wildcard category should have no labels
			expect(result.categories[4]).toEqual({
				title: "Other Changes",
			});
		});

		it("should add default template", () => {
			const githubConfig = {
				changelog: {
					categories: [],
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			expect(result.template).toBe(
				"## What's Changed\n\n$CHANGES\n\n$FULL_CHANGELOG",
			);
		});

		it("should handle config with only exclusions (no categories)", () => {
			const githubConfig = {
				changelog: {
					exclude: {
						labels: ["wontfix", "duplicate"],
						authors: ["dependabot"],
					},
				},
			};

			const result = convertGitHubToReleaseDrafter(githubConfig);

			expect(result["exclude-labels"]).toEqual(["wontfix", "duplicate"]);
			expect(result["exclude-contributors"]).toEqual(["dependabot"]);
			expect(result.categories).toBeUndefined();
			expect(result.template).toBe(
				"## What's Changed\n\n$CHANGES\n\n$FULL_CHANGELOG",
			);
		});

		it("should warn about category-level exclusions", () => {
			// Capture stderr output
			const originalStderr = process.stderr.write;
			let stderrOutput = "";
			process.stderr.write = (chunk) => {
				stderrOutput += chunk;
				return true;
			};

			const githubConfig = {
				changelog: {
					categories: [
						{
							title: "Other Changes",
							labels: ["*"],
							exclude: {
								labels: ["dependencies"],
							},
						},
					],
				},
			};

			convertGitHubToReleaseDrafter(githubConfig);

			// Restore stderr
			process.stderr.write = originalStderr;

			expect(stderrOutput).toContain("Other Changes");
			expect(stderrOutput).toContain("Warning:");
		});
	});

	describe("normalizeConfig", () => {
		it("should convert GitHub format configs", () => {
			// Note: verbose logging is disabled by default, so no output expected

			const githubConfig = {
				changelog: {
					categories: [
						{
							title: "Features",
							labels: ["feature"],
						},
					],
				},
			};

			const result = normalizeConfig(githubConfig);

			// Since verbose is disabled by default, no log output expected
			expect(result.categories).toBeDefined();
			expect(result.template).toBeDefined();
		});

		it("should pass through release-drafter format configs", () => {
			const releaseDrafterConfig = {
				template: "## Custom Template",
				categories: [
					{
						title: "Features",
						labels: ["feature"],
					},
				],
			};

			const result = normalizeConfig(releaseDrafterConfig);

			expect(result).toBe(releaseDrafterConfig);
		});

		it("should pass through unknown format configs", () => {
			const unknownConfig = {
				someField: "value",
			};

			const result = normalizeConfig(unknownConfig);

			expect(result).toBe(unknownConfig);
		});
	});
});
