import { logVerbose } from "./logger";

/**
 * Check if a GitHub user has sponsors by making a HEAD request to their sponsors page.
 * This is an experimental approach to work around GitHub API limitations.
 *
 * @param login GitHub username
 * @returns URL if user has sponsors page, undefined otherwise
 */
async function checkSponsorPageExists(
	login: string,
): Promise<string | undefined> {
	const sponsorUrl = `https://github.com/sponsors/${login}`;

	try {
		const response = await fetch(sponsorUrl, {
			method: "HEAD",
			headers: {
				"User-Agent": "actionutils-gh-release-notes",
			},
		});

		// If we get a 200 OK, the sponsor page exists
		if (response.status === 200) {
			logVerbose(`[SponsorHTML] Found sponsor page for ${login}`);
			return sponsorUrl;
		}

		// 404 means no sponsor page
		if (response.status === 404) {
			logVerbose(`[SponsorHTML] No sponsor page for ${login}`);
			return undefined;
		}

		// Rate limiting or other client errors - log warning but don't fail
		if (
			response.status === 429 ||
			(response.status >= 400 && response.status < 500)
		) {
			console.warn(
				`[SponsorHTML] Warning: Got ${response.status} checking sponsor page for ${login}. ` +
					`This may indicate rate limiting or access restrictions. Skipping sponsor check.`,
			);
			return undefined;
		}

		// Other unexpected status codes
		logVerbose(
			`[SponsorHTML] Unexpected status ${response.status} for ${login}, assuming no sponsor page`,
		);
		return undefined;
	} catch (error) {
		// Network errors or other issues - log warning but don't fail
		const errorMessage = error instanceof Error ? error.message : String(error);
		console.warn(
			`[SponsorHTML] Warning: Failed to check sponsor page for ${login}: ${errorMessage}. ` +
				`Continuing without sponsor information.`,
		);
		return undefined;
	}
}

/**
 * Enrich pull requests with sponsor information using HTML HEAD requests.
 * If any errors occur (rate limits, 4xx errors, network issues),
 * returns the original data without sponsor information rather than failing.
 *
 * @param pullRequests Array of pull requests from GraphQL
 * @returns Pull requests with sponsor URLs added where available
 */
export async function enrichWithHtmlSponsorData(
	pullRequests: any[],
): Promise<any[]> {
	logVerbose(
		`[SponsorHTML] Checking sponsor pages for ${pullRequests.length} PRs`,
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

	logVerbose(
		`[SponsorHTML] Found ${uniqueAuthors.size} unique authors to check`,
	);

	// Check sponsor pages for all unique authors
	const sponsorResults = new Map<string, string | undefined>();
	let successCount = 0;
	let errorCount = 0;

	for (const login of uniqueAuthors.keys()) {
		const sponsorUrl = await checkSponsorPageExists(login);
		sponsorResults.set(login, sponsorUrl);

		if (sponsorUrl) {
			successCount++;
		} else if (sponsorUrl === undefined) {
			// Only count as error if we got an explicit error (not just 404)
			const lastWarning = console.warn.toString();
			if (lastWarning.includes(login)) {
				errorCount++;
			}
		}

		// If we're getting too many errors, bail out early to avoid issues
		if (errorCount > 5) {
			console.warn(
				`[SponsorHTML] Too many errors checking sponsor pages. ` +
					`Stopping sponsor enrichment to avoid rate limits.`,
			);
			// Clear remaining results to ensure we don't return partial data
			for (const remainingLogin of uniqueAuthors.keys()) {
				if (!sponsorResults.has(remainingLogin)) {
					sponsorResults.set(remainingLogin, undefined);
				}
			}
			break;
		}
	}

	logVerbose(
		`[SponsorHTML] Found ${successCount} sponsors out of ${uniqueAuthors.size} authors checked`,
	);

	// If we had too many errors, return original data without modifications
	if (errorCount > 5) {
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
