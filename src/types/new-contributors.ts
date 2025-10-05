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
}

export interface NewContributorsResult {
	newContributors: NewContributor[];
	totalContributors: number;
	apiCallsUsed: number;
}
