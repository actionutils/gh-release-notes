import { describe, expect, it, mock } from "bun:test";
import {
	findNewContributors,
	formatNewContributorsSection,
} from "./new-contributors";

// Helper function to convert PRs to contributors format
function extractContributorsFromPRs(
	pullRequests: Array<{
		author?: { login?: string; [key: string]: unknown };
		number: number;
		title: string;
		url: string;
		mergedAt: string;
	}>,
) {
	const contributorsMap = new Map();
	for (const pr of pullRequests) {
		if (!pr.author?.login) continue;
		const login = pr.author.login;
		if (!contributorsMap.has(login)) {
			contributorsMap.set(login, {
				...pr.author,
				pullRequests: [],
			});
		}
		contributorsMap.get(login).pullRequests.push({
			number: pr.number,
			title: pr.title,
			url: pr.url,
			mergedAt: pr.mergedAt,
		});
	}
	return Array.from(contributorsMap.values());
}

describe("new-contributors", () => {
	describe("findNewContributors", () => {
		it("should identify new contributors correctly", async () => {
			const mockPullRequests = [
				{
					number: 100,
					title: "Add new feature",
					url: "https://github.com/owner/repo/pull/100",
					mergedAt: "2024-01-15T10:00:00Z",
					author: {
						login: "user1",
						type: "User",
						url: "https://github.com/user1",
						avatarUrl: "",
					},
					labels: { nodes: [] },
				},
				{
					number: 101,
					title: "Fix bug",
					url: "https://github.com/owner/repo/pull/101",
					mergedAt: "2024-01-16T10:00:00Z",
					author: {
						login: "existing-user",
						type: "User",
						url: "https://github.com/existing-user",
						avatarUrl: "",
					},
					labels: { nodes: [] },
				},
				{
					number: 102,
					title: "Update docs",
					url: "https://github.com/owner/repo/pull/102",
					mergedAt: "2024-01-17T10:00:00Z",
					author: {
						login: "github-actions",
						type: "Bot",
						url: "https://github.com/apps/github-actions",
						avatarUrl: "",
					},
					labels: { nodes: [] },
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

			global.fetch = mockFetch as unknown as typeof fetch;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				contributors: extractContributorsFromPRs(mockPullRequests),
				filteredPullRequests: mockPullRequests,
				token: "test-token",
			});

			expect(result.newContributors).toHaveLength(2);
			expect(result.newContributors[0].login).toBe("github-actions");
			expect(result.newContributors[1].login).toBe("user1");
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

			global.fetch = mockFetch as unknown as typeof fetch;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				contributors: [],
				filteredPullRequests: [],
				token: "test-token",
			});

			expect(result.newContributors).toHaveLength(0);
			expect(result.totalContributors).toBe(0);
			expect(result.apiCallsUsed).toBe(0);
		});

		it("should identify new contributors with prev release date", async () => {
			const mockPullRequests = [
				{
					number: 200,
					title: "New feature from new contributor",
					url: "https://github.com/owner/repo/pull/200",
					mergedAt: "2024-02-15T10:00:00Z",
					author: {
						login: "newuser",
						type: "User",
						url: "https://github.com/newuser",
						avatarUrl: "",
					},
					labels: { nodes: [] },
				},
				{
					number: 201,
					title: "Another PR from existing user",
					url: "https://github.com/owner/repo/pull/201",
					mergedAt: "2024-02-16T10:00:00Z",
					author: {
						login: "olduser",
						type: "User",
						url: "https://github.com/olduser",
						avatarUrl: "",
					},
					labels: { nodes: [] },
				},
			];

			const mockGraphQLResponses = [
				{
					newuser: {
						issueCount: 0, // No PRs before the prev release date
						nodes: [],
					},
					olduser: {
						issueCount: 3, // Has PRs before the prev release date
						nodes: [
							{
								number: 150,
								title: "Old PR",
								url: "https://github.com/owner/repo/pull/150",
								mergedAt: "2024-01-05T10:00:00Z",
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

			global.fetch = mockFetch as unknown as typeof fetch;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				contributors: extractContributorsFromPRs(mockPullRequests),
				filteredPullRequests: mockPullRequests,
				token: "test-token",
				prevReleaseDate: "2024-02-01T00:00:00Z",
			});

			expect(result.newContributors).toHaveLength(1);
			expect(result.newContributors[0].login).toBe("newuser");
			expect(result.newContributors[0].firstPullRequest.number).toBe(200);
			expect(result.totalContributors).toBe(2);
			expect(result.apiCallsUsed).toBe(2);
		});

		it("should handle contributors with numeric usernames", async () => {
			const mockPullRequests = [
				{
					number: 200,
					title: "Numeric user PR",
					url: "https://github.com/owner/repo/pull/200",
					mergedAt: "2024-01-20T10:00:00Z",
					author: {
						login: "0xFANGO",
						type: "User",
						url: "https://github.com/0xFANGO",
						avatarUrl: "",
					},
					labels: { nodes: [] },
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

			global.fetch = mockFetch as unknown as typeof fetch;

			const result = await findNewContributors({
				owner: "owner",
				repo: "repo",
				contributors: extractContributorsFromPRs(mockPullRequests),
				filteredPullRequests: mockPullRequests,
				token: "test-token",
			});

			expect(result.newContributors).toHaveLength(1);
			expect(result.newContributors[0].login).toBe("0xFANGO");
		});
	});

	describe("formatNewContributorsSection", () => {
		it("should format new contributors section correctly", () => {
			const newContributors = [
				{
					login: "user1",
					firstPullRequest: {
						number: 100,
						title: "First PR",
						url: "https://github.com/owner/repo/pull/100",
						mergedAt: "2024-01-15T10:00:00Z",
					},
				},
				{
					login: "bot-user",
					firstPullRequest: {
						number: 101,
						title: "Bot PR",
						url: "https://github.com/owner/repo/pull/101",
						mergedAt: "2024-01-16T10:00:00Z",
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
