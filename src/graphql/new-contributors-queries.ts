import type { Contributor } from "../types/new-contributors";

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
): string {
	const searchQueries = contributors
		.map((contributor) => {
			const alias = generateAlias(contributor.login);
			const searchLogin = getSearchLogin(contributor);
			return `
    ${alias}: search(
      query: "repo:${owner}/${repo} is:pr is:merged author:${searchLogin}"
      type: ISSUE
      first: 2
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
