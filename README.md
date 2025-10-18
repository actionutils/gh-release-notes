# gh-release-notes

PR-based release notes generator with strong compatibility with GitHub’s Generate Release Notes and release-drafter. Zero-config works out of the box, and you can keep using your existing `.github/release.yml` or `.github/release-drafter.yml`.

Highlights
- Flexible templating with MiniJinja for finer control than release-drafter templates
- JSON output to drive any templating engine or downstream tooling
- Remote config/template via GitHub purl for easy organization-wide sharing
- Works with read-only permissions; no write permission needed (see Permissions)

Use cases
- Generate release notes from PRs with existing configs
- Automate in CI/CD or preview locally
- Shape the output via JSON or your favorite templating engine

## Installation

- Static binary (recommended): download from Releases
  - https://github.com/actionutils/gh-release-notes/releases
  - Place the binary on your PATH (e.g., `/usr/local/bin/gh-release-notes`)
- npx (no install):
  - `npx @actionutils/gh-release-notes` (or add options as needed)
- GitHub CLI extension:
  - Install: `gh extension install actionutils/gh-release-notes`
  - Upgrade: `gh extension upgrade actionutils/gh-release-notes`

## Usage

- Generate from latest changes (auto-detects previous release):
  - `gh-release-notes`
  - As gh extension: `gh release-notes`
- Specify previous and next tags:
  - `gh-release-notes --prev-tag v1.0.0 --tag v1.1.0`
- Target a branch/revision:
  - `gh-release-notes --target main`
- Use a MiniJinja template:
  - `gh-release-notes --template ./templates/release.jinja`
- JSON output (for scripting or custom rendering):
  - `gh-release-notes --json > release.json`

Tip: You can read the resolved version fields from the output (e.g., `release.resolvedVersion`) to decide tagging and releasing logic in your pipeline.

## Configuration and Compatibility

Zero-config works
- You can run `gh-release-notes` without any config and get a sensible, GitHub-like changelog.
Use existing configs
- `.github/release.yml` (GitHub Generate Release Notes)
- `.github/release-drafter.yml` (release-drafter)

Getting a config
- Start from a minimal, compatible config via `gh-release-notes init` (writes `.github/release-drafter.yml`, use `-o -` to print, `--force` to overwrite)
- Already on GitHub’s `.github/release.yml`? Convert it with `gh-release-notes migrate` (supports `--source`/`--output` and `-o -`)

Remote configs/templates
- Prefer GitHub purl: `pkg:github/OWNER/REPO@REF#path/to/config.yaml`
  - Recommended over raw.githubusercontent.com due to rate limits
  - Great for shared organization-wide config and templates
- HTTPS URLs and local files are also supported

## Templates and Output

Default behavior
- Uses release-drafter–style templates from your config
- Adds two extra placeholders: `$FULL_CHANGELOG_LINK`, `$NEW_CONTRIBUTORS`
- Fetches only fields required by your template to keep API calls minimal

MiniJinja for maximum flexibility
- `--template <path|https|purl>` renders with the same data as `--json`
- Bring your own structure and style (or use community-maintained templates)

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

- Contributors may include their GitHub Sponsors listing URL in the output
- Fetching modes: `auto`, `graphql`, `html`, `none`
  - `auto`: intelligently selects based on token type and usage
  - `graphql`: requires a user token (PAT, etc.); App tokens (including `GITHUB_TOKEN`) are blocked by GitHub for this field
  - `html`: HEAD-requests sponsor pages (experimental); backs off on errors/rate limits

## Differences from release-drafter

- Extra placeholders available: `$FULL_CHANGELOG_LINK`, `$NEW_CONTRIBUTORS`
- Zero-config works; also easy to standardize via purl remote config/templates
- JSON output enables fully custom rendering pipelines
- Optional sponsor enrichment (adds sponsors listing URL when available)

## Permissions

- Public repositories: works without any token for most operations
- Private repositories: requires only read scopes
  - `contents: read`
  - `pull_requests: read`
- Unlike GitHub’s Release Notes Generator API, this tool does not need `contents: write`

## License

MIT
