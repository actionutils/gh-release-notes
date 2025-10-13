import { logVerbose, logWarning } from "./logger";

/**
 * Result of checking a sponsor page
 */
type SponsorCheckResult = {
	sponsorUrl?: string;
	hasError: boolean;
};

/**
 * Check if a GitHub user has sponsors by making a HEAD request to their sponsors page.
 * This is an experimental approach to work around GitHub API limitations.
 *
 * @param login GitHub username
 * @returns Object with sponsorUrl (if exists) and error state
 */
async function checkSponsorPageExists(
	login: string,
): Promise<SponsorCheckResult> {
	const sponsorUrl = `https://github.com/sponsors/${login}`;

	try {
		// Use redirect: 'manual' to prevent automatic following of redirects
		// GitHub redirects non-existent sponsor pages to user profiles
		const response = await fetch(sponsorUrl, {
			method: "HEAD",
			headers: {
				"User-Agent": "actionutils-gh-release-notes",
			},
			redirect: "manual",
		});

		// If we get a 200 OK without redirect, the sponsor page exists
		if (response.status === 200) {
			logVerbose(`[SponsorHTML] Found sponsor page for ${login}`);
			return { sponsorUrl, hasError: false };
		}

		// 301/302/303/307/308 are redirects - means no sponsor page
		// (GitHub redirects to user profile when sponsor page doesn't exist)
		if (response.status >= 300 && response.status < 400) {
			logVerbose(`[SponsorHTML] No sponsor page for ${login} (redirected)`);
			return { hasError: false };
		}

		// 404 means no sponsor page (shouldn't happen with current GitHub behavior)
		if (response.status === 404) {
			logVerbose(`[SponsorHTML] No sponsor page for ${login}`);
			return { hasError: false };
		}

		// Rate limiting or other client errors - log warning but don't fail
		if (
			response.status === 429 ||
			(response.status >= 400 && response.status < 500)
		) {
			logWarning(
				`[SponsorHTML] Got ${response.status} checking sponsor page for ${login}. ` +
					`This may indicate rate limiting or access restrictions. Skipping sponsor check.`,
			);
			return { hasError: true };
		}

		// Other unexpected status codes
		logVerbose(
			`[SponsorHTML] Unexpected status ${response.status} for ${login}, assuming no sponsor page`,
		);
		return { hasError: false };
	} catch (error) {
		// Network errors or other issues - log warning but don't fail
		const errorMessage = error instanceof Error ? error.message : String(error);
		logWarning(
			`[SponsorHTML] Failed to check sponsor page for ${login}: ${errorMessage}. ` +
				`Continuing without sponsor information.`,
		);
		return { hasError: true };
	}
}

/**
 * Process a batch of authors in parallel with error tracking
 */
async function processBatch(
	batch: string[],
	sponsorResults: Map<string, string | undefined>,
	errorTracker: {
		count: number;
		shouldStop: boolean;
	},
): Promise<{ successCount: number }> {
	const promises = batch.map(async (login) => {
		const result = await checkSponsorPageExists(login);
		sponsorResults.set(login, result.sponsorUrl);
		return { login, ...result };
	});

	const results = await Promise.all(promises);

	// Count successes and check for errors
	let batchSuccessCount = 0;
	for (const result of results) {
		if (result.sponsorUrl) {
			batchSuccessCount++;
		} else if (result.hasError) {
			// This was an error (rate limit, network issue, etc.)
			errorTracker.count++;
			if (errorTracker.count > 5) {
				errorTracker.shouldStop = true;
				logWarning(
					`[SponsorHTML] Too many errors checking sponsor pages. ` +
						`Stopping sponsor enrichment to avoid rate limits.`,
				);
			}
		}
	}

	return { successCount: batchSuccessCount };
}

/**
 * Enrich pull requests with sponsor information using HTML HEAD requests.
 * If any errors occur (rate limits, 4xx errors, network issues),
 * returns the original data without sponsor information rather than failing.
 *
 * @param pullRequests Array of pull requests from GraphQL
 * @param maxConcurrency Maximum number of parallel requests (default: 5)
 * @returns Pull requests with sponsor URLs added where available
 */
export async function enrichWithHtmlSponsorData(
	pullRequests: Array<{
		number: number;
		author?: {
			login?: string;
			__typename?: string;
			[key: string]: unknown;
		};
		[key: string]: unknown;
	}>,
	maxConcurrency = 5,
): Promise<Array<{
	number: number;
	author?: {
		login?: string;
		__typename?: string;
		sponsorsListing?: { url: string };
		[key: string]: unknown;
	};
	[key: string]: unknown;
}>> {
	logVerbose(
		`[SponsorHTML] Checking sponsor pages for ${pullRequests.length} PRs (max ${maxConcurrency} parallel)`,
	);

	// Collect unique authors to check
	const uniqueAuthors = new Map<string, Set<number>>();
	for (const pr of pullRequests) {
		const login = pr.author?.login;
		if (login && pr.author?.__typename === "User") {
			if (!uniqueAuthors.has(login)) {
				uniqueAuthors.set(login, new Set());
			}
			uniqueAuthors.get(login)!.add(pr.number);
		}
	}

	const authorsList = Array.from(uniqueAuthors.keys());
	logVerbose(
		`[SponsorHTML] Found ${authorsList.length} unique authors to check`,
	);

	// Check sponsor pages in parallel batches
	const sponsorResults = new Map<string, string | undefined>();
	let totalSuccessCount = 0;
	const errorTracker = {
		count: 0,
		shouldStop: false,
	};

	// Process authors in batches
	for (let i = 0; i < authorsList.length; i += maxConcurrency) {
		if (errorTracker.shouldStop) {
			// Clear remaining results to ensure we don't return partial data
			for (let j = i; j < authorsList.length; j++) {
				sponsorResults.set(authorsList[j], undefined);
			}
			break;
		}

		const batch = authorsList.slice(i, i + maxConcurrency);
		logVerbose(
			`[SponsorHTML] Processing batch ${Math.floor(i / maxConcurrency) + 1}/${Math.ceil(authorsList.length / maxConcurrency)} (${batch.length} authors)`,
		);

		const { successCount } = await processBatch(
			batch,
			sponsorResults,
			errorTracker,
		);
		totalSuccessCount += successCount;
	}

	logVerbose(
		`[SponsorHTML] Found ${totalSuccessCount} sponsors out of ${authorsList.length} authors checked`,
	);

	// If we had too many errors, return original data without modifications
	if (errorTracker.count > 5) {
		logVerbose(`[SponsorHTML] Returning original data due to errors`);
		return pullRequests;
	}

	// Enrich pull requests with sponsor data
	return pullRequests.map((pr) => {
		const login = pr.author?.login;
		if (!login || pr.author?.__typename !== "User") {
			return pr;
		}

		const sponsorUrl = sponsorResults.get(login);
		if (sponsorUrl) {
			return {
				...pr,
				author: {
					...pr.author,
					sponsorsListing: { url: sponsorUrl },
				},
			};
		}

		return pr;
	});
}
