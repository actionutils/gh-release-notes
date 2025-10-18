# gh-release-notes

PR-based release notes generator. Nearly 100% compatible with GitHub Generate Release Notes and release-drafter configs, so you can keep using existing `.github/release.yml` or `.github/release-drafter.yml` as-is. Adds practical features like remote configs/templates, MiniJinja, full JSON output, and optional new-contributors/sponsor enrichment.

- Compatible: `.github/release.yml` (auto-converted) / `.github/release-drafter.yml` (used as-is)
- Added: remote config/template (HTTPS/purl + checksum), MiniJinja, JSON output
- Helpful: repo auto-detection, `include-paths`, `$FULL_CHANGELOG_LINK`/`$NEW_CONTRIBUTORS`

Requires Node.js 22+.

## Overview

gh-release-notes is a CLI/library that generates PR-based release notes. It reuses release-drafter internals and is nearly 100% compatible with GitHub’s Generate Release Notes and release-drafter configuration. It adds practical features such as remote config loading, MiniJinja templates, full JSON output, and optional sponsor information.

Typical use cases
- Generate PR-based release notes using existing `.github/release-drafter.yml` or `.github/release.yml` as-is
- Automate in CI/CD, preview locally, or post-process via JSON
- Distribute organization-wide shared config (e.g., in a `.github` repo) via purl/HTTPS

## Installation

- npm (global): `npm i -g @actionutils/gh-release-notes`
- In a project: `npm i -D @actionutils/gh-release-notes` (then `npx gh-release-notes ...`)

## Usage

- Generate from latest changes (auto-detect previous release):
  - `gh-release-notes`
- Specify previous and next tags:
  - `gh-release-notes --prev-tag v1.0.0 --tag v1.1.0`
- Target a branch/revision:
  - `gh-release-notes --target main`
- JSON output (for templating and post-processing):
  - `gh-release-notes --json > release.json`
- Generate body with a MiniJinja template:
  - `gh-release-notes --template ./templates/release.jinja`
- Load config from remote:
  - `gh-release-notes --config https://example.com/release.yaml`
  - `gh-release-notes --config pkg:github/owner/repo@v1#.github/release-drafter.yml`

Key options
- `--repo, -R` Target repo (`owner/repo`). Auto-detected if omitted
- `--config, -c` Config source (local/HTTPS/purl)
- `--template, -t` MiniJinja template (local/HTTPS/purl)
- `--prev-tag` Explicit previous tag
- `--tag` New release tag
- `--target, --ref` Target branch/commit
- `--json` Output JSON
- `--preview` Preview mode (Full Changelog compares against `target`)
- `--skip-new-contributors` Skip fetching new contributors (fewer API calls)
- `--sponsor-fetch-mode` `none|graphql|html|auto` (default `auto`)
- `--verbose, -v` Verbose logs

Repository detection order
1. `--repo`
2. `GITHUB_REPOSITORY` (GitHub Actions)
3. `GH_REPO`
4. Current directory’s `git remote` (respects `gh auth` hosts and `GH_HOST`)

Token resolution order
1. `--token` (when using as a library)
2. `GITHUB_TOKEN`
3. `GH_TOKEN`
4. `gh auth token` (GitHub CLI)

## Configuration and Compatibility

Supported configuration formats
1) release-drafter format (recommended)
- File: `.github/release-drafter.yml`
- Loaded and validated as-is using release-drafter’s schema

2) GitHub Generate Release Notes format
- File: `.github/release.yml` or `.github/release.yaml`
- Automatically converted to release-drafter format internally

Conversion highlights
- `changelog.exclude.labels` → `exclude-labels`
- `changelog.exclude.authors` → `exclude-contributors`
- `changelog.categories[*].labels` → `categories[*].labels`
- `labels: ["*"]` wildcard maps to release-drafter’s “no-label category” for remaining items
- Per-category excludes (labels/authors) are flattened into global excludes for compatibility

Config lookup order
- If `--config` is provided (local/HTTPS/purl), use it
- Otherwise, search `.github/release-drafter.yml` → `.github/release.yml` → `.github/release.yaml`
- If none exists, use built-in defaults (GitHub-like template/sort)

Defaults (excerpt)
- Change template: `- $TITLE by @$AUTHOR in $URL`
- Category heading: `### $TITLE`
- Body template: `## What's Changed\n\n$CHANGES\n\n$NEW_CONTRIBUTORS\n\n**Full Changelog**: $FULL_CHANGELOG_LINK`
- Sort direction: `ascending` (aligns with GitHub)

Remote config loading
- HTTPS: `--config https://example.com/path/to/config.yaml`
- purl (GitHub): `--config pkg:github/owner/repo@version#path/to/config.yaml`
- Checksums: `?checksum=sha256:...` (multiple allowed, comma-separated)
- purl uses the GitHub API and requires a token (`GITHUB_TOKEN`, etc.)

Filtering with include-paths
- When `include-paths` is set, changed files for each PR are fetched via GraphQL and only PRs touching those paths are kept
- Useful to restrict output to specific areas in large repos

## Templates and Output

Two modes
- Use release-drafter templates (compat mode)
  - Set `template`, `change-template`, `category-template` in config
  - Supports `$FULL_CHANGELOG_LINK` and `$NEW_CONTRIBUTORS`
  - Only fetch fields required by `change-template` (e.g., `$BODY`, `$BASE_REF_NAME`, `$HEAD_REF_NAME`) to minimize API calls
- Generate with MiniJinja freely
  - Provide `--template <path|https|purl>`
  - Renders with the same data as `--json`
  - Distribute org-wide templates via purl/HTTPS

JSON structure (main fields)
- `release`: `name`, `tag`, `body`, `targetCommitish`, `resolvedVersion`, `majorVersion`, `minorVersion`, `patchVersion`
- `mergedPullRequests[]`: `number`, `title`, `url`, `mergedAt`, `author{ login, type, url, avatarUrl, sponsorsListing? }`, `labels[]`
- `categorizedPullRequests`:
  - `uncategorized[]`
  - `categories[]`: `title`, `labels[]`, `collapse_after?`, `pullRequests[]`
- `contributors[]`: all PR authors
- `newContributors[] | null`: first-time contributors + first PR details
- `owner`, `repo`, `defaultBranch`, `lastRelease`, `fullChangelogLink`

Example (MiniJinja)
```
## Release {{ release.tag }}

### ✨ Highlights
{% for pr in mergedPullRequests %}
{% if loop.index <= 5 %}
- {{ pr.title }} (#{{ pr.number }}) by @{{ pr.author.login }}
{% endif %}
{% endfor %}

**Full Changelog**: {{ fullChangelogLink }}
```

## Sponsor Information

- Controlled via `--sponsor-fetch-mode` (`auto`/`graphql`/`html`/`none`)
  - `graphql`: requires a user token (PAT, etc.). App tokens (including `GITHUB_TOKEN`) are blocked by GitHub for this field
  - `html`: checks the sponsor page with HEAD (experimental). Stops automatically if too many errors/rate limits
  - `auto`: auto-selects based on token type and output mode
  - Extra data is considered only with `--json` or `--template`; otherwise API calls are minimized

## Compatibility and Differences

- `.github/release.yml` is auto-converted; `.github/release-drafter.yml` is used as-is
- Default template/ordering aligned with GitHub (ascending)
- Categorization compatible with release-drafter (`include-labels`, `exclude-labels`, `categories`)
- Per-category excludes in `.github/release.yml` are flattened to global excludes (not perfectly 1:1)
- `sponsorsListing` via GraphQL is unavailable with GitHub App tokens; `auto` may fall back to HTML HEAD checks

## Migration Guide

From release-drafter
1. Keep `.github/release-drafter.yml`
2. Run `gh-release-notes` (optionally add `--json` or `--template`)

From GitHub Generate Release Notes
1. Keep `.github/release.yml` (auto-converted internally)
2. Run `gh-release-notes`

Tips
- For finer control, migrate closer to release-drafter format
- For maximum flexibility, combine `--json` with `--template`

## License

MIT
