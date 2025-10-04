**Repo Auto-Detection (TypeScript CLI, No “Smart” Resolution)**

- Implement up to reading local git remotes and picking the best candidate.
- Do not query APIs or resolve repository networks.
- Ignore remote “resolution” metadata (like `remote.<name>.gh-resolved`) unless you explicitly want a “set-default” feature.

**Priority Order**

- `--repo` flag (highest priority)
- `GH_REPO` environment variable
- Current directory’s git remotes

**Flag/Env Parsing**

- Accept `[HOST/]OWNER/REPO` and full URLs (SSH/HTTPS).
- Centralize parsing in `parseRepoRef(input, defaultHost) -> Repo`.
- Normalize: remove `.git`, lowercase host, strip `www.`.

**Git Remotes Parsing**

- Execute `git remote -v` and parse lines: `<name> <url> (fetch|push)`.
- Combine `fetch`/`push` URLs under each remote name.
- Normalize URLs to `{ host, owner, name }`:
  - HTTPS: `https://host/owner/repo(.git)`
  - SSH: `git@host:owner/repo(.git)` (and tenant forms if you need them later)
- Keep only entries that parse successfully.

**Host Filtering**

- Keep only remotes for authenticated hosts (from your CLI’s config).
- If `GH_HOST` is set, further restrict to that host.
- Error cases:
  - No authenticated hosts: prompt to run `auth login`.
  - `GH_HOST` set but no matching remote: ask to add a matching remote or unset `GH_HOST`.

**Remote Prioritization**

- Sort remotes by name score, descending:
  - `upstream` > `github` > `origin` > others
- Break ties by name or leave as-is; determinism is recommended.
- Choose the first candidate after filtering and sorting.

**Errors and UX**

- No git remotes: “No git remotes found.” (suggest running in a repo or adding remotes)
- No candidates after filtering: explain whether the cause is missing auth or `GH_HOST` mismatch.
- Keep messages actionable and short.

**TypeScript Structure (Suggested)**

- `interface Repo { owner: string; name: string; host: string }`
- `resolveBaseRepo(opts): Promise<Repo>`
  - Uses `--repo` → `GH_REPO` → `git remotes`
- Helpers:
  - `parseRepoRef(input: string, defaultHost: string): Repo | null`
  - `readGitRemotes(): Promise<Array<{ name: string; fetch?: string; push?: string }>>`
  - `normalizeGitURL(u: string): Repo | null`
  - `remoteScore(name: string): number`
  - `getAuthedHosts(): string[]` (from your CLI config)
  - `filterByHosts(repos: Repo[], authed: string[], ghHost?: string): Repo[]`

**Pseudocode**

```ts
type Repo = { owner: string; name: string; host: string };

export async function resolveBaseRepo(opts: {
  flagRepo?: string;
  defaultHost: string;
}): Promise<Repo> {
  // 1) Flag or env
  if (opts.flagRepo) {
    const r = parseRepoRef(opts.flagRepo, opts.defaultHost);
    if (!r) throw new Error("Invalid --repo value");
    return r;
  }
  if (process.env.GH_REPO) {
    const r = parseRepoRef(process.env.GH_REPO, opts.defaultHost);
    if (!r) throw new Error("Invalid GH_REPO value");
    return r;
  }

  // 2) Remotes
  const authedHosts = getAuthedHosts(); // e.g., ["github.com", "ghe.example.com"]
  if (authedHosts.length === 0) {
    throw new Error("No authenticated hosts. Run `mycli auth login`.");
  }

  const remotes = await readGitRemotes(); // from `git remote -v`
  if (remotes.length === 0) {
    throw new Error("No git remotes found.");
  }

  // Collect normalized repo candidates from fetch/push URLs
  const repos: Array<{ name: string; repo: Repo }> = [];
  for (const r of remotes) {
    for (const url of [r.fetch, r.push]) {
      if (!url) continue;
      const parsed = normalizeGitURL(url);
      if (parsed) repos.push({ name: r.name, repo: parsed });
    }
  }

  // Filter by hosts
  const ghHost = process.env.GH_HOST;
  const byAuth = repos.filter(x =>
    authedHosts.some(h => x.repo.host.toLowerCase() === h.toLowerCase())
  );
  if (byAuth.length === 0) {
    throw new Error(
      "No remotes match any authenticated host. Run `mycli auth login` or add matching remotes."
    );
  }

  const filtered = ghHost
    ? byAuth.filter(x => x.repo.host.toLowerCase() === ghHost.toLowerCase())
    : byAuth;
  if (ghHost && filtered.length === 0) {
    throw new Error(
      `No remotes match GH_HOST=${ghHost}. Add a matching remote or unset GH_HOST.`
    );
  }

  // Sort by remote name preference
  const scored = filtered
    .map(x => ({ score: remoteScore(x.name), repo: x.repo }))
    .sort((a, b) => b.score - a.score);

  return scored[0].repo;
}

function remoteScore(name: string): number {
  switch (name.toLowerCase()) {
    case "upstream":
      return 3;
    case "github":
      return 2;
    case "origin":
      return 1;
    default:
      return 0;
  }
}
```

**Testing Checklist**

- `--repo` and `GH_REPO` accepted formats: `OWNER/REPO`, `HOST/OWNER/REPO`, HTTPS URL, SSH URL.
- Remote parsing: fetch/push lines, `.git` suffix, `www.`, case-insensitive hosts.
- Auth host filtering: none configured → error; multiple hosts; `GH_HOST` narrowing and mismatch error.
- Priority order correctness.
- Remote name preference ordering.

**Notes**

- This design mirrors gh’s simple “BaseRepo” selection without network resolution or prompts.
- If you later want a “set-default” feature, you can store and honor a per-remote default (e.g., `remote.<name>.gh-resolved`), but it’s not required for this spec.

