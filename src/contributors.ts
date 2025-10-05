import { logVerbose } from "./logger";

export type MinimalContributor = { login: string; isBot: boolean };
export type ContributorWithAvatar = {
	login: string;
	isBot: boolean;
	avatar_url: string;
};

// Build minimal contributors list from merged PRs
export function buildMinimalContributors(
	pullRequests: any[] | undefined,
	excludeContributors: string[] = [],
): MinimalContributor[] {
	const flags = new Map<string, MinimalContributor>();
	for (const pr of pullRequests || []) {
		const login = pr.author?.login as string | undefined;
		if (!login) continue;
		const isBot = pr.author?.__typename === "Bot";
		if (!flags.has(login)) {
			flags.set(login, { login, isBot });
		}
	}
	const result = Array.from(flags.values())
		.filter((c) => !excludeContributors.includes(c.login))
		.sort((a, b) => a.login.localeCompare(b.login));
	logVerbose(`[Contributors] Collected ${result.length} unique contributors`);
	return result;
}

// NOTE: Ideally we should modify release-drafter's GraphQL query to include
// PR author avatarUrl and avoid any extra calls. However, GitHub's GraphQL API
// cannot resolve Bot accounts by login (user/search), so as a pragmatic
// workaround we resolve avatars for Bot contributors via REST
//   GET /users/{login%5Bbot%5D}
// Non-bot contributors use a deterministic avatar URL pattern that does not
// require API calls.
export async function enrichContributorAvatars(
	contributors: MinimalContributor[],
	rest: (pathname: string) => Promise<any>,
): Promise<ContributorWithAvatar[]> {
	const result: ContributorWithAvatar[] = contributors.map((c) => ({
		login: c.login,
		isBot: c.isBot,
		avatar_url: c.isBot
			? ""
			: `https://github.com/${encodeURIComponent(c.login)}.png?size=64`,
	}));

	const botContributors = result.filter((c) => c.isBot);
	if (botContributors.length === 0) return result;

	await Promise.all(
		botContributors.map(async (c) => {
			try {
				const loginForRest = /\[bot\]$/i.test(c.login)
					? c.login
					: `${c.login}[bot]`;
				const user = await rest(`/users/${encodeURIComponent(loginForRest)}`);
				let url = String(user.avatar_url || "");
				url += url.includes("?") ? "&s=64" : "?s=64";
				c.avatar_url = url;
			} catch {
				// Leave empty if not resolvable; callers can decide how to handle it
			}
		}),
	);

	return result;
}
