import { describe, expect, it, mock } from "bun:test";
import {
	findNewContributors,
	formatNewContributorsSection,
} from "./new-contributors";
import type { NewContributor } from "./types/new-contributors";

describe("new-contributors", () => {
	describe("findNewContributors", () => {
		it("should identify new contributors correctly", async () => {
			const mockPullRequests = [
				{
					number: 100,
					title: "Add new feature",
					url: "https://github.com/owner/repo/pull/100",
					merged_at: "2024-01-15T10:00:00Z",
					author: { login: "user1", __typename: "User" },
				},
				{
					number: 101,
					title: "Fix bug",
					url: "https://github.com/owner/repo/pull/101",
					merged_at: "2024-01-16T10:00:00Z",
					author: { login: "existing-user", __typename: "User" },
				},
				{
					number: 102,
					title: "Update docs",
					url: "https://github.com/owner/repo/pull/102",
					merged_at: "2024-01-17T10:00:00Z",
					author: { login: "github-actions", __typename: "Bot" },
				},
			];

			const mockGraphQLResponses = [
				{
					user1: {
						issueCount: 1,
						nodes: [
							{
								number: 100,
								title: "Add new feature",
								url: "https://github.com/owner/repo/pull/100",
								mergedAt: "2024-01-15T10:00:00Z",
							},
						],
					},
					existing_user: {
						issueCount: 5,
						nodes: [
							{
								number: 50,
								title: "Previous PR",
								url: "https://github.com/owner/repo/pull/50",
								mergedAt: "2023-12-01T10:00:00Z",
							},
							{
								number: 60,
								title: "Another PR",
								url: "https://github.com/owner/repo/pull/60",
								mergedAt: "2023-12-15T10:00:00Z",
							},
						],
					},
					github_actions: {
						issueCount: 1,
						nodes: [
							{
								number: 102,
								title: "Update docs",
								url: "https://github.com/owner/repo/pull/102",
								mergedAt: "2024-01-17T10:00:00Z",
							},
						],
					},
				},
			];

			let callIndex = 0;
			const mockFetch = mock(() => {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({ data: mockGraphQLResponses[callIndex++] }),
					text: () => Promise.resolve(""),
				});
			});

			global.fetch = mockFetch as any;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				pullRequests: mockPullRequests,
				token: "test-token",
			});

			expect(result.newContributors).toHaveLength(2);
			expect(result.newContributors[0].login).toBe("github-actions");
			expect(result.newContributors[0].isBot).toBe(true);
			expect(result.newContributors[1].login).toBe("user1");
			expect(result.newContributors[1].isBot).toBe(false);
			expect(result.totalContributors).toBe(3);
			expect(result.apiCallsUsed).toBe(2);
		});

		it("should handle empty pull requests list", async () => {
			const mockFetch = mock(() => {
				return Promise.resolve({
					ok: true,
					json: () => Promise.resolve({ data: {} }),
					text: () => Promise.resolve(""),
				});
			});

			global.fetch = mockFetch as any;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				pullRequests: [],
				token: "test-token",
			});

			expect(result.newContributors).toHaveLength(0);
			expect(result.totalContributors).toBe(0);
			expect(result.apiCallsUsed).toBe(0);
		});

		it("should handle contributors with numeric usernames", async () => {
			const mockPullRequests = [
				{
					number: 200,
					title: "Numeric user PR",
					url: "https://github.com/owner/repo/pull/200",
					merged_at: "2024-01-20T10:00:00Z",
					author: { login: "0xFANGO", __typename: "User" },
				},
			];

			const mockGraphQLResponses = [
				{
					u_0xFANGO: {
						issueCount: 1,
						nodes: [
							{
								number: 200,
								title: "Numeric user PR",
								url: "https://github.com/owner/repo/pull/200",
								mergedAt: "2024-01-20T10:00:00Z",
							},
						],
					},
				},
			];

			let callIndex = 0;
			const mockFetch = mock(() => {
				return Promise.resolve({
					ok: true,
					json: () =>
						Promise.resolve({ data: mockGraphQLResponses[callIndex++] }),
					text: () => Promise.resolve(""),
				});
			});

			global.fetch = mockFetch as any;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				pullRequests: mockPullRequests,
				token: "test-token",
			});

			expect(result.newContributors).toHaveLength(1);
			expect(result.newContributors[0].login).toBe("0xFANGO");
		});
	});

	describe("formatNewContributorsSection", () => {
		it("should format new contributors section correctly", () => {
			const newContributors: NewContributor[] = [
				{
					login: "user1",
					isBot: false,
					pullRequests: [],
					firstPullRequest: {
						number: 100,
						title: "First PR",
						url: "https://github.com/owner/repo/pull/100",
						mergedAt: "2024-01-15T10:00:00Z",
						author: { login: "user1", __typename: "User" },
					},
				},
				{
					login: "bot-user",
					isBot: true,
					pullRequests: [],
					firstPullRequest: {
						number: 101,
						title: "Bot PR",
						url: "https://github.com/owner/repo/pull/101",
						mergedAt: "2024-01-16T10:00:00Z",
						author: { login: "bot-user", __typename: "Bot" },
					},
				},
			];

			const formatted = formatNewContributorsSection(newContributors);

			expect(formatted).toContain("## New Contributors");
			expect(formatted).toContain(
				"@user1 made their first contribution in https://github.com/owner/repo/pull/100",
			);
			expect(formatted).toContain(
				"@bot-user made their first contribution in https://github.com/owner/repo/pull/101",
			);
		});

		it("should return empty string for no new contributors", () => {
			const formatted = formatNewContributorsSection([]);
			expect(formatted).toBe("");
		});
	});
});
