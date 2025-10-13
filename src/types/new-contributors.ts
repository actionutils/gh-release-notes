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

export interface NewContributor {
	login: string;
	firstPullRequest: PullRequestInfo;
	[key: string]: unknown; // Allow any other fields from GraphQL
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
	pullRequests: Array<{
		number: number;
		title: string;
		url?: string;
		mergedAt?: string;
		author?: Record<string, unknown>;
		[key: string]: unknown;
	}>;
	token: string;
	prevReleaseDate?: string;
}

export interface NewContributorsResult {
	newContributors: NewContributor[];
	totalContributors: number;
	apiCallsUsed: number;
}
