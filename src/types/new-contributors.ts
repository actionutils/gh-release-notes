export interface PullRequestAuthor {
	login: string;
	__typename: "User" | "Bot";
}

export interface PullRequestInfo {
	number: number;
	title: string;
	url: string;
	mergedAt: string;
	author: PullRequestAuthor | null;
}

export interface Contributor {
	login: string;
	isBot: boolean;
	pullRequests: PullRequestInfo[];
}

export interface NewContributor extends Contributor {
	firstPullRequest: PullRequestInfo;
}

// Simplified version for JSON output (without internal details)
export interface NewContributorOutput {
	login: string;
	isBot: boolean;
	firstPullRequest: PullRequestInfo;
	avatar_url?: string;
	html_url?: string;
}

export interface ContributorCheckResult {
	login: string;
	isBot: boolean;
	isNewContributor: boolean;
	prCount: number;
	firstPullRequest?: PullRequestInfo;
}

export interface BatchCheckOptions {
	owner: string;
	repo: string;
	contributors: Contributor[];
	batchSize?: number;
}

export interface NewContributorsOptions {
	owner: string;
	repo: string;
	pullRequests: any[];
	token: string;
	prevReleaseDate?: string;
}

export interface NewContributorsResult {
	newContributors: NewContributor[];
	totalContributors: number;
	apiCallsUsed: number;
}

// Result for JSON output (without internal metrics)
export interface NewContributorsOutputResult {
	newContributors: NewContributorOutput[];
	totalContributors: number;
}
