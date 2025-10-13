// Minimal interface for what this module needs
interface Contributor {
	login: string;
	isBot: boolean;
}

function generateAlias(login: string): string {
	if (/^\d/.test(login)) {
		return `u_${login.replace(/[^a-zA-Z0-9_]/g, "_")}`;
	}
	return login.replace(/[^a-zA-Z0-9_]/g, "_");
}

function getSearchLogin(contributor: Contributor): string {
	return contributor.isBot ? `${contributor.login}[bot]` : contributor.login;
}

export function buildBatchContributorQuery(
	owner: string,
	repo: string,
	contributors: Contributor[],
	beforeDate?: string,
): string {
	const searchQueries = contributors
		.map((contributor) => {
			const alias = generateAlias(contributor.login);
			const searchLogin = getSearchLogin(contributor);
			// If we have a beforeDate, search for PRs merged before that date
			// Otherwise, search for all merged PRs (for detecting first-time contributors)
			const dateFilter = beforeDate ? ` merged:<${beforeDate}` : "";
			const firstCount = beforeDate ? 1 : 2; // We only need to know if they have ANY PRs before the date
			return `
    ${alias}: search(
      query: "repo:${owner}/${repo} is:pr is:merged author:${searchLogin}${dateFilter}"
      type: ISSUE  # GitHub GraphQL uses ISSUE type for both issues and PRs (is:pr filters for PRs)
      first: ${firstCount}
    ) {
      issueCount
      nodes {
        ... on PullRequest {
          number
          title
          url
          mergedAt
        }
      }
    }`;
		})
		.join("\n");

	return `
  query BatchCheckContributors {
    ${searchQueries}
  }`;
}
