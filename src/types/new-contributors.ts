export interface PullRequestInfo {
	number: number;
	title: string;
	url: string;
	mergedAt: string;
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
