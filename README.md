# gh-release-notes

[![OpenSSF Scorecard](https://api.scorecard.dev/projects/github.com/actionutils/gh-release-notes/badge)](https://scorecard.dev/viewer/?uri=github.com/actionutils/gh-release-notes)

PR-based release notes generator with strong compatibility with GitHub’s Generate Release Notes and release-drafter. Zero-config works out of the box, and you can keep using your existing `.github/release.yml` or `.github/release-drafter.yml`.

### Highlights
- Flexible templating with MiniJinja for finer control than release-drafter templates
- JSON output to drive any templating engine or downstream tooling
- Remote config/template via GitHub purl for easy organization-wide sharing
- Works with read-only permissions; no write permission needed (see Permissions)

### Use cases
- Generate release notes from PRs with existing configs
- Automate in CI/CD or preview locally
- Shape the output via JSON or your favorite templating engine

## Installation

Quick install (latest)
- Install the binary
```shell
curl -sSfL https://github.com/actionutils/gh-release-notes/releases/latest/download/install.sh | sh
```
- Or run directly without installation
```shell
curl -sSfL https://github.com/actionutils/gh-release-notes/releases/latest/download/run.sh | sh
```

<details>
<summary>Verify latest with cosign</summary>

```shell
# Choose the script to execute
SCRIPT="install.sh"  # or "run.sh"
DOWNLOAD_URL="https://github.com/actionutils/gh-release-notes/releases/latest/download"

curl -sL "${DOWNLOAD_URL}/${SCRIPT}" | \
  (tmpfile=$(mktemp); cat > "$tmpfile"; \
   cosign verify-blob \
     --certificate-identity-regexp '^https://github.com/actionutils/trusted-go-releaser/.github/workflows/trusted-release-workflow.yml@.*$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     --certificate "${DOWNLOAD_URL}/${SCRIPT}.pem" \
     --signature "${DOWNLOAD_URL}/${SCRIPT}.sig" \
     "$tmpfile" && \
   sh "$tmpfile"; rm -f "$tmpfile")
```

</details>

<details>
<summary>Install a specific version (with optional signature verification)</summary>

Specific version (simple)

Install
```shell
VERSION="<version>"  # e.g., v0.6.0
curl -sSfL "https://github.com/actionutils/gh-release-notes/releases/download/${VERSION}/install.sh" | sh
```

Run without installation
```shell
VERSION="<version>"  # e.g., v0.6.0
curl -sSfL "https://github.com/actionutils/gh-release-notes/releases/download/${VERSION}/run.sh" | sh
```

Specific version (verified with cosign)

Install (verified)
```shell
VERSION="<version>"  # e.g., v0.6.0
BASE="https://github.com/actionutils/gh-release-notes/releases/download/${VERSION}"
curl -sL "${BASE}/install.sh" | \
  (tmpfile=$(mktemp); cat > "$tmpfile"; \
   cosign verify-blob \
     --certificate-identity-regexp '^https://github.com/actionutils/trusted-go-releaser/.github/workflows/trusted-release-workflow.yml@.*$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     --certificate "${BASE}/install.sh.pem" \
     --signature "${BASE}/install.sh.sig" \
     "$tmpfile" && \
   sh "$tmpfile"; rm -f "$tmpfile")
```

Run without installation (verified)
```shell
VERSION="<version>"  # e.g., v0.6.0
BASE="https://github.com/actionutils/gh-release-notes/releases/download/${VERSION}"
curl -sL "${BASE}/run.sh" | \
  (tmpfile=$(mktemp); cat > "$tmpfile"; \
   cosign verify-blob \
     --certificate-identity-regexp '^https://github.com/actionutils/trusted-go-releaser/.github/workflows/trusted-release-workflow.yml@.*$' \
     --certificate-oidc-issuer 'https://token.actions.githubusercontent.com' \
     --certificate "${BASE}/run.sh.pem" \
     --signature "${BASE}/run.sh.sig" \
     "$tmpfile" && \
   sh "$tmpfile"; rm -f "$tmpfile")
```

</details>

### GitHub CLI extension

Install
```shell
gh extension install actionutils/gh-release-notes
```

Upgrade
```shell
gh extension upgrade actionutils/gh-release-notes
```

### npx / pnpx / bunx (no install)

```shell
npx  @actionutils/gh-release-notes
pnpx @actionutils/gh-release-notes
bunx @actionutils/gh-release-notes
```

## Usage

- Generate from latest changes (auto-detects previous release):
  ```shell
  gh-release-notes
  ```
  As gh extension:
  ```shell
  gh release-notes
  ```
- Specify previous and next tags:
  ```shell
  gh-release-notes --prev-tag v1.0.0 --tag v1.1.0
  ```
- Target a branch/revision:
  ```shell
  gh-release-notes --target main
  ```
- Use a MiniJinja template:
  ```shell
  gh-release-notes --template ./templates/github.md.jinja
  gh-release-notes --template pkg:github/actionutils/gh-release-notes@main#templates/table.md.jinja
  ```
- JSON output (for scripting or custom rendering):
  ```shell
  gh-release-notes --json > release.json
  ```

Tip: You can read the resolved version fields from the output (e.g., `release.resolvedVersion`) to decide tagging and releasing logic in your pipeline.

## Configuration and Compatibility

### Zero-config works
- You can run `gh-release-notes` without any config and get a sensible, GitHub-like changelog.
Use existing configs
- `.github/release.yml` (GitHub Generate Release Notes)
- `.github/release-drafter.yml` (release-drafter)

### Getting a config
- Start from a minimal, compatible config via `gh-release-notes init` (writes `.github/release-drafter.yml`, use `-o -` to print, `--force` to overwrite)
- Already on GitHub’s `.github/release.yml`? Convert it with `gh-release-notes migrate` (supports `--source`/`--output` and `-o -`)

### Remote configs/templates
- Prefer GitHub purl: `pkg:github/OWNER/REPO@REF#path/to/config.yaml`
  - Recommended over raw.githubusercontent.com due to rate limits
  - Great for shared organization-wide config and templates
- HTTPS URLs and local files are also supported

```shell
gh-release-notes --config pkg:github/actionutils/gh-release-notes@main#.github/release-drafter.yml
```

## Templates and Output

### Default behavior
- Uses release-drafter–style templates from your release-drafter config
- Adds two extra placeholders: `$FULL_CHANGELOG_LINK`, `$NEW_CONTRIBUTORS`
- Fetches only fields required by your template to keep API calls minimal

### MiniJinja for maximum flexibility
- `--template <path|https|purl>` renders with the same data as `--json`
- Bring your own structure and style (or use community-maintained templates)

### JSON structure (example)
- `release`: `name`, `tag`, `body`, `targetCommitish`, `resolvedVersion`, `majorVersion`, `minorVersion`, `patchVersion`
- `mergedPullRequests[]`: `number`, `title`, `url`, `mergedAt`, `author{ login, type, url, avatarUrl, sponsorsListing? }`, `labels[]`
- `categorizedPullRequests`:
  - `uncategorized[]`
  - `categories[]`: `title`, `labels[]`, `collapse_after?`, `pullRequests[]`
- `contributors[]`: all PR authors
- `newContributors[] | null`: first-time contributors + first PR details
- `owner`, `repo`, `defaultBranch`, `lastRelease`, `fullChangelogLink`

### Example (MiniJinja)
```jinja
## Release {{ release.tag }}

### ✨ Highlights
{% for pr in mergedPullRequests %}
{% if loop.index <= 5 %}
- {{ pr.title }} (#{{ pr.number }}) by @{{ pr.author.login }}
{% endif %}
{% endfor %}

**Full Changelog**: {{ fullChangelogLink }}
```

## Contributors' Sponsor Information

- Contributors may include their GitHub Sponsors listing URL in the output
- Fetching modes: `auto`, `graphql`, `html`, `none`
  - `auto`: intelligently selects based on token type and usage
  - `graphql`: requires a user token (PAT, etc.); App tokens (including `GITHUB_TOKEN`) are blocked by GitHub for this field
  - `html`: HEAD-requests sponsor pages (experimental); backs off on errors/rate limits

<table>
  <thead>
    <tr>
      <th width="500px">Example</th>
      <th width="500px">Template</th>
    </tr>
  </thead>
  <tbody>
  <tr width="600px">
<td>

## Contributors of reviewdog v0.21.0

<table>
  <tbody>
    <tr>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/apps/renovate">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/in/2740?v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="renovate"/><br />
        </a>
        <sub>@renovate[bot]</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/massongit">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/15100604?u=f8f5854f11feb098158beb14c52ca943968ce331&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="massongit"/><br />
        </a>
        <sub>@massongit</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/apps/dependabot">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/in/29110?v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="dependabot"/><br />
        </a>
        <sub>@dependabot[bot]</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/haya14busa">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/3797062?v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="haya14busa"/><br />
        </a>
        <sub>@haya14busa</sub>
        <br><br>
        <a href="https://github.com/sponsors/haya14busa" title="Sponsor haya14busa">
          <img src="https://img.shields.io/badge/-Sponsor-ea4aaa?style=for-the-badge&logo=github&logoColor=white" height="24" />
        </a>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/apps/github-actions">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/in/15368?v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="github-actions"/><br />
        </a>
        <sub>@github-actions[bot]</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/Kaniikura">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/32826608?u=14f90a1fc8ef4a3aacebf0365687c0d57600bac4&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="Kaniikura"/><br />
        </a>
        <sub>@Kaniikura</sub>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/dallonf">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/346300?u=67c6d2adec340c11c2d49139bf75ae139a384869&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="dallonf"/><br />
        </a>
        <sub>@dallonf</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/Bilka2">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/27060268?u=a8189ec8365502d313c00ab02773ef1d19ab8564&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="Bilka2"/><br />
        </a>
        <sub>@Bilka2</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/niwis">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/6498078?u=1dd2adb340aa1e46b1c1ae1b673dda5644c94ae1&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="niwis"/><br />
        </a>
        <sub>@niwis</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/yudrywet">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/166895665?u=cae0fe10803112aed2510d7488094bec122bcf7c&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="yudrywet"/><br />
        </a>
        <sub>@yudrywet</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/shogo82148">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/1157344?v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="shogo82148"/><br />
        </a>
        <sub>@shogo82148</sub>
        <br><br>
        <a href="https://github.com/sponsors/shogo82148" title="Sponsor shogo82148">
          <img src="https://img.shields.io/badge/-Sponsor-ea4aaa?style=for-the-badge&logo=github&logoColor=white" height="24" />
        </a>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/wizardishungry">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/15206?u=e56247b2eec1e04966b0c81cd8247f3936e632be&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="wizardishungry"/><br />
        </a>
        <sub>@wizardishungry</sub>
      </td>
    </tr>
    <tr>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/wlynch">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/1844673?u=608c2e4e3a71f0e7ddd59da1b0c551551c0a1bd1&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="wlynch"/><br />
        </a>
        <sub>@wlynch</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/brunohaf">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/31559311?u=fb290e378037f94a0c938f9bb2260c3875a6646f&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="brunohaf"/><br />
        </a>
        <sub>@brunohaf</sub>
      </td>
      <td align="center" valign="top" width="100">
        <a href="https://github.com/lafriks">
          <img src="https://wsrv.nl/?url=https://avatars.githubusercontent.com/u/165205?u=efe2335d2197f524c25caa7abdfcb90b77eb8d98&v=4&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="lafriks"/><br />
        </a>
        <sub>@lafriks</sub>
        <br><br>
        <a href="https://github.com/sponsors/lafriks" title="Sponsor lafriks">
          <img src="https://img.shields.io/badge/-Sponsor-ea4aaa?style=for-the-badge&logo=github&logoColor=white" height="24" />
        </a>
      </td>
    </tr>
  </tbody>
</table>

</td>
<td>

```jinja
## Contributors of reviewdog v0.21.0

<table>
  <tbody>
    <tr>
{%- for contributor in contributors %}
      <td align="center" valign="top" width="100">
        <a href="{{ contributor.url }}">
          <img src="https://wsrv.nl/?url={{ contributor.avatarUrl }}&w=64&h=64&mask=circle&fit=cover&maxage=1w" width="64px" alt="{{ contributor.login }}"/><br />
        </a>
        <sub>@{{ contributor.login }}{% if contributor.type == 'Bot' %}[bot]{% endif %}</sub>
        {%- if contributor.sponsorsListing %}
        <br><br>
        <a href="{{ contributor.sponsorsListing.url }}" title="Sponsor {{ contributor.login }}">
          <img src="https://img.shields.io/badge/-Sponsor-ea4aaa?style=for-the-badge&logo=github&logoColor=white" height="24" />
        </a>
        {%- endif %}
      </td>
{%- if loop.index % 6 == 0 and not loop.last %}
    </tr>
    <tr>
{%- endif %}
{%- endfor %}
    </tr>
  </tbody>
</table>
{%- endif %}
```

</td>
  </tr>
  </tbody>
</table>

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
