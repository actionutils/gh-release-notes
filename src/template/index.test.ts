import { expect, test, describe, beforeAll, afterAll } from "bun:test";
import fs from "node:fs";
import path from "node:path";
import { TemplateRenderer } from "./index";

describe("TemplateRenderer", () => {
	const testDir = path.join(process.cwd(), "test-templates");
	const testTemplate = path.join(testDir, "test.jinja");

	beforeAll(() => {
		// Create test directory and template file
		fs.mkdirSync(testDir, { recursive: true });
		fs.writeFileSync(
			testTemplate,
			`# Release Notes for {{ release.name }}

## Changes
{% for pr_number in mergedPullRequests %}
- #{{ pr_number }}: {{ pullRequests[pr_number|string].title }} (@{{ pullRequests[pr_number|string].author.login }})
{% endfor %}

## Contributors
{% for contributor in contributors %}
- @{{ contributor.login }}
{% endfor %}

## Full Changelog
{{ fullChangelogLink }}`,
		);
	});

	afterAll(() => {
		// Clean up test files
		fs.rmSync(testDir, { recursive: true, force: true });
	});

	test("renders local template with data", async () => {
		const renderer = new TemplateRenderer();
		const data = {
			release: {
				name: "v1.0.0",
			},
			pullRequests: {
				1: { number: 1, title: "Add new feature", author: { login: "user1" } },
				2: { number: 2, title: "Fix bug", author: { login: "user2" } },
			},
			mergedPullRequests: [1, 2],
			contributors: [{ login: "user1" }, { login: "user2" }],
			fullChangelogLink:
				"https://github.com/owner/repo/compare/v0.9.0...v1.0.0",
		};

		const result = await renderer.loadAndRender(testTemplate, data);

		expect(result).toContain("# Release Notes for v1.0.0");
		expect(result).toContain("#1: Add new feature (@user1)");
		expect(result).toContain("#2: Fix bug (@user2)");
		expect(result).toContain("@user1");
		expect(result).toContain("@user2");
		expect(result).toContain(
			"https://github.com/owner/repo/compare/v0.9.0...v1.0.0",
		);
	});

	test("handles categorized pull requests", async () => {
		const renderer = new TemplateRenderer();
		const templateContent = `{% for category in categorizedPullRequests.categories %}
## {{ category.title }}
{% for n in category.pullRequests %}
- #{{ n }}: {{ pullRequests[n|string].title }}
{% endfor %}
{% endfor %}`;

		fs.writeFileSync(path.join(testDir, "categorized.jinja"), templateContent);

		const data = {
			pullRequests: {
				1: { number: 1, title: "Add feature A" },
				2: { number: 2, title: "Add feature B" },
				3: { number: 3, title: "Fix bug X" },
			},
			categorizedPullRequests: {
				uncategorized: [],
				categories: [
					{ title: "🚀 Features", pullRequests: [1, 2] },
					{ title: "🐛 Bug Fixes", pullRequests: [3] },
				],
			},
		};

		const result = await renderer.loadAndRender(
			path.join(testDir, "categorized.jinja"),
			data,
		);

		expect(result).toContain("## 🚀 Features");
		expect(result).toContain("#1: Add feature A");
		expect(result).toContain("#2: Add feature B");
		expect(result).toContain("## 🐛 Bug Fixes");
		expect(result).toContain("#3: Fix bug X");
	});

	test("handles new contributors", async () => {
		const renderer = new TemplateRenderer();
		const templateContent = `{% if newContributors %}
## New Contributors
{% for contributor in newContributors %}
- @{{ contributor.login }} made their first contribution in #{{ contributor.firstPullRequest }}
{% endfor %}
{% endif %}`;

		fs.writeFileSync(
			path.join(testDir, "new-contributors.jinja"),
			templateContent,
		);

		const data = {
			newContributors: [
				{ login: "newuser1", firstPullRequest: 10 },
				{ login: "newuser2", firstPullRequest: 11 },
			],
		};

		const result = await renderer.loadAndRender(
			path.join(testDir, "new-contributors.jinja"),
			data,
		);

		expect(result).toContain("## New Contributors");
		expect(result).toContain("@newuser1 made their first contribution in #10");
		expect(result).toContain("@newuser2 made their first contribution in #11");
	});

	test("handles empty data gracefully", async () => {
		const renderer = new TemplateRenderer();
		const templateContent = `# Release
{% if mergedPullRequests %}
PRs: {{ mergedPullRequests | length }}
{% else %}
No pull requests
{% endif %}`;

		fs.writeFileSync(path.join(testDir, "empty.jinja"), templateContent);

		const data = {
			mergedPullRequests: [],
		};

		const result = await renderer.loadAndRender(
			path.join(testDir, "empty.jinja"),
			data,
		);

		expect(result).toContain("No pull requests");
		expect(result).not.toContain("PRs:");
	});

	test("throws error for non-existent template", async () => {
		const renderer = new TemplateRenderer();

		expect(async () => {
			await renderer.loadAndRender("/non/existent/template.jinja", {});
		}).toThrow();
	});
});
