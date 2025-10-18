# Config Init and Migrate Design Document

## Overview
Introduce two helper subcommands to bootstrap and migrate configuration files for gh-release-notes:

- `gh-release-notes init` — initialize a new Release Drafter–style config from scratch.
- `gh-release-notes migrate` — convert a GitHub `.github/release.yml(release.yaml)` into a Release Drafter–style `.github/release-drafter.yml`.

Both commands are file-centric (no GitHub API calls) and aim for safe, predictable behavior with clear overwrite controls.

## Motivation
- Lower the barrier to adopt or standardize on Release Drafter–compatible configs.
- Provide a guided, safe path from GitHub’s auto-generated release notes config to Release Drafter.
- Encourage consistent defaults aligned with gh-release-notes behavior and templates.

## Goals
- Smooth migration from `.github/release.yml` to `.github/release-drafter.yml` with good defaults.
- Zero-to-one config initialization that reflects current gh-release-notes defaults.
- Safe file operations: don’t overwrite without `--force`; support writing to stdout via `--output=-` for previewing.

## Non‑Goals
- Perfect round‑trip between formats (lossless comments, unsupported per‑category excludes, etc.).
- Remote migration (URLs or purl). Initial scope is local files. We can extend later if needed.
- Changing the main generation workflow; the root command behavior stays the same.

## UX and CLI

### Command forms
- Top‑level only:
  - `gh-release-notes init [options]`
  - `gh-release-notes migrate [options]`

### init
Initialize a Release Drafter–style config.

- Synopsis:
  - `gh-release-notes init [--output <path>] [--force]`
- Defaults:
  - Output path: `.github/release-drafter.yml` (created along with parent folder if missing).
- Options:
  - `--output, -o <path>`: Where to write the config; default is `.github/release-drafter.yml`. Use `--output=-` to print to stdout and skip writing.
  - `--force`: Overwrite the output file if it already exists.

- Output content (minimal default with comments):
  - Start from `DEFAULT_FALLBACK_CONFIG` in `src/constants.ts` (template, change/category templates, sort direction).
  - Emit a compact YAML that includes inline comments to guide users on common extensions such as categories, include/exclude-labels, and contributors.
  - Example shape (comments indicative):
    ```yaml
    # Release Drafter configuration initialized by gh-release-notes
    # Add categories to group PRs, e.g.:
    # categories:
    #   - title: Features
    #     labels: [feature, enhancement]
    template: |
      ## What's Changed

      $CHANGES

      $NEW_CONTRIBUTORS

      **Full Changelog**: $FULL_CHANGELOG_LINK
    change-template: "- $TITLE by @$AUTHOR in $URL"
    category-template: "### $TITLE"
    sort-direction: ascending
    # exclude-labels: ["skip-changelog"]
    # include-labels: ["release-notes"]
    # exclude-contributors: ["dependabot[bot]"]
    ```

- Behavior:
  - If the file already exists and content would be identical, exit 0 with a short “up-to-date” message.
  - If the file exists with different content, require `--force` to overwrite.

### migrate
Convert GitHub’s `.github/release.yml` (or `.github/release.yaml`) into a Release Drafter–style config.

- Synopsis:
  - `gh-release-notes migrate [--source <path>] [--output <path>] [--force]`
- Defaults:
  - Source detection: prefer `.github/release.yml`, then `.github/release.yaml` in the current working directory.
  - Output path: `.github/release-drafter.yml`.
- Options:
  - `--source, -s <path>`: Explicit path to a GitHub release config.
  - `--output, -o <path>`: Output path for Release Drafter config (default `.github/release-drafter.yml`). Use `--output=-` to print to stdout and skip writing.
  - `--force`: Overwrite if output file exists.

- Behavior:
  - If no source is found or the source file is invalid YAML, exit with a clear error.
  - If the source already looks like Release Drafter format, print a message and either:
    - Write a normalized Release Drafter file if requested explicitly, or
    - Exit with a “nothing to migrate” message.
  - If the output exists and differs, require `--force` to overwrite.

## Conversion Rules
We reuse the existing converter in `src/github-config-converter.ts`:
- Detection: `isGitHubReleaseConfig(config)` verifies GitHub’s `release.yml` shape by checking `changelog`.
- Baseline: Start from `DEFAULT_FALLBACK_CONFIG` to ensure a complete, sane config.
- Exclusions:
  - `changelog.exclude.labels` → `exclude-labels`
  - `changelog.exclude.authors` → `exclude-contributors`
- Categories:
  - Map each GitHub category `{ title, labels }` to Release Drafter category `{ title, labels }`.
  - Wildcard categories (`labels: ["*"]`) become a catch‑all by omitting `labels` in Release Drafter (bucket for uncategorized/remaining items).
  - Per‑category excludes are not supported by Release Drafter; we surface a warning and rely on global excludes. For wildcard categories, Release Drafter’s “uncategorized only” behavior often approximates intent.

Notes and caveats:
- YAML comments from the source cannot be preserved.
- Any keys not recognized are carried through as‑is only if they exist in the fallback base; otherwise they’re dropped.
- The resulting config is validated later by Release Drafter’s schema during normal runs; migrate focuses on faithful field mapping.

## Implementation

### Code structure
- CLI wiring:
  - Extend `src/cli.ts` with two new top‑level commands via yargs (`init`, `migrate`).
  - Keep the existing root (notes generation) behavior unchanged.
- New modules:
  - `src/commands/init.ts`: generate YAML from presets and write/print per flags.
  - `src/commands/migrate.ts`: read source YAML, parse via `js-yaml`, call `convertGitHubToReleaseDrafter`, emit YAML.
- Reuse:
  - `src/github-config-converter.ts` for conversion.
  - `src/constants.ts` for defaults.
  - Existing logger (`logVerbose`) for verbose output; use concise messages by default.
- YAML emit:
  - Use `js-yaml` `dump` with stable sort and 2-space indent. Keep output minimal and deterministic.

### Flags and safety
- Never overwrite files unless `--force`.
- Create parent folders for default output path if missing.
- Exit with non‑zero status on validation or IO errors, with actionable messages.

### Telemetry/messages
- Human‑readable one‑liners for each action (created/overwrote/skipped).
- On migrate, print warnings when encountering per‑category excludes that cannot be mapped exactly.

## Testing Strategy
- Unit tests:
  - `init`: emits minimal YAML with expected defaults and comments; `--force` behavior.
  - `migrate`: conversion parity with `convertGitHubToReleaseDrafter`; wildcard category behavior; warning emission.
- Integration tests:
  - Temp workspace with `.github/release.yml` → generates `.github/release-drafter.yml`.
  - Safe overwrite and identical‑content short‑circuit.
- E2E smoke:
  - Run commands in a sample repo fixture to ensure end‑to‑end behavior with real files.

## Examples
```bash
# Initialize a minimal config (default path)
gh-release-notes init

# Initialize, print to stdout
gh-release-notes init --output=-

# Migrate from .github/release.yml to .github/release-drafter.yml
gh-release-notes migrate

# Migrate with explicit source and print to stdout
gh-release-notes migrate --source config/release.yaml --output=-


## Backward Compatibility
- No changes to the primary `gh-release-notes` generation flow or flags.
- New subcommands are opt‑in utilities.

## Open Questions
- Should `migrate` support URLs/purl as sources? Initial scope limits to local files; can extend later using the existing content loaders.

## Rollout Plan
1. Implement CLI scaffolding and core logic behind `init` and `migrate`.
2. Add tests and docs, including README snippets and `--help` examples.
3. Release in a minor version (e.g., 0.x+1) and gather feedback.
