# Lightweight PR-only GraphQL for Release Notes

## Context
- Goal: Always use a lightweight PR-only data flow to generate release notes, while staying compatible with release-drafter config/templates.
- Motivation: Avoid commit history scans and associated GraphQL pagination. Directly fetching merged PRs is significantly lighter. For include-paths, filter PRs by changed files via GraphQL in batched queries (no fallback).

## Baseline (for reference)
- release-drafter internals typically do:
  - findReleases → detect previous release.
  - findCommitsWithAssociatedPullRequests → GraphQL commit history scan + PR association.
  - sortPullRequests → ordering by mergedAt/title.
  - generateReleaseInfo → builds body ($CHANGES, $CONTRIBUTORS, etc.).
- This repo already adds:
  - New contributors detection via separate batched GraphQL searches.
  - Contributors avatar enrichment (REST for bots, deterministic URL for users).

## Problem
- Commit history scanning is heavy. We only need merged PRs in the period since the previous release for most templates and outputs.

## Design Overview

### 1) PR-only fetch (GraphQL search)
- Use GraphQL search scoped to repo and merged PRs, bounded by previous release timestamp when available.
- Query string: `repo:OWNER/REPO is:pr is:merged merged:>ISO_TIMESTAMP` (strictly greater to mirror RD logic). If no previous release, see Edge Cases.
- Fields (conditionally included based on template needs to stay light):
  - Core: `number`, `title`, `mergedAt`, `labels(first: 100) { nodes { name } }`, `author { login __typename url ... }`
  - Optional: `body` ($BODY), `url` ($URL), `baseRefName` ($BASE_REF_NAME), `headRefName` ($HEAD_REF_NAME)
  - Optional user extras (best-effort): `author { ... on User { avatarUrl sponsorsListing { url } } }`

Example (field gating by @include):

```graphql
query SearchMergedPRs(
  $q: String!
  $withBody: Boolean!
  $withURL: Boolean!
  $withBase: Boolean!
  $withHead: Boolean!
  $after: String
) {
  search(query: $q, type: ISSUE, first: 100, after: $after) {
    pageInfo { hasNextPage endCursor }
    nodes {
      ... on PullRequest {
        number
        title
        mergedAt
        url @include(if: $withURL)
        body @include(if: $withBody)
        baseRefName @include(if: $withBase)
        headRefName @include(if: $withHead)
        labels(first: 100) { nodes { name } }
        author {
          login
          __typename
          url
          ... on User { avatarUrl sponsorsListing { url } }
        }
      }
    }
  }
}
```

### 2) include-paths support via GraphQL batched changed-files
- When config has `include-paths`, filter the fetched PR set by changed files using the GraphQL `PullRequest.files` connection.
- Batched query form (aliases per PR number) against the repository:

```graphql
query FilesForPRs(
  $owner: String!
  $name: String!
  $after_pr1: String
  $after_pr2: String
) {
  repo: repository(owner: $owner, name: $name) {
    pr1: pullRequest(number: 123) {
      files(first: 100, after: $after_pr1) {
        pageInfo { hasNextPage endCursor }
        nodes { path previousFilePath }
      }
    }
    pr2: pullRequest(number: 456) {
      files(first: 100, after: $after_pr2) {
        pageInfo { hasNextPage endCursor }
        nodes { path previousFilePath }
      }
    }
  }
}
```

- We chunk PRs (e.g., 20–40 per query) to respect complexity limits.
- For PRs with `hasNextPage`, we loop with per-PR cursors until all files are retrieved or a match is found (early-exit per PR when matched to save cost).
- Matching semantics:
  - Treat `include-paths` entries as path prefixes from repo root.
  - A PR is included if any `path` (or `previousFilePath`) starts with any configured include-path.
- No REST fallback; if GraphQL fails due to auth/scope/complexity, surface a clear error and suggest narrowing include-paths or reducing chunk size.

### 3) Data flow integration
- Replace commit+PR collection with:
  - `pullRequests = fetchMergedPRs()` (GraphQL search + pagination).
  - If `include-paths` present → `pullRequests = filterByChangedFilesGraphQL(pullRequests)` (batched files queries with cursors and early-exit).
  - `commits = []` (commit nodes aren’t needed for templates; `$CONTRIBUTORS` is computed from PR authors by release-drafter).
- Keep using `sortPullRequests` from release-drafter to preserve ordering semantics.
- Keep using `generateReleaseInfo` unchanged (consumes PR list + config to produce body, including `$CHANGES` and the contributors sentence).

## Compatibility
- Sorting: `sortPullRequests` (mergedAt/title + direction) unchanged → identical ordering.
- Categorization/version resolution: requires `labels(first: 100)`; preserved.
- Template variables: fetch only required fields based on presence in `change-template`.
- Contributors: `$CONTRIBUTORS` remains correct via PR authors; empty `commits` is acceptable.
- Avatars/sponsors: JSON output may include enriched fields; templates remain unchanged.

## Edge Cases
- Time window:
  - Use `merged:>lastRelease.created_at` for strict greater-than.
  - If search returns PRs outside the window, filter client-side as a safeguard.
- No previous release:
  - Documented behavior: generate notes from “recent” merged PRs (configurable window) or require a baseline tag for full history equivalence. Start with documented behavior, iterate based on usage.
- Large PRs (files pagination):
  - For PRs with many files, continue querying with PR-specific cursors. Abort early on first match.
- GraphQL complexity/rate-limits:
  - Chunk PRs per query (tunable). On rate-limit, back off and retry respecting reset time.

## Implementation Plan
- Add `src/graphql/pr-queries.ts`:
  - Query builder + variables based on config needs (withBody/withURL/withBase/withHead).
  - `fetchMergedPRs` pagination over the search connection; returns RD-compatible PR nodes.
- Add `src/graphql/pr-files-queries.ts`:
  - Build batched files queries with aliases per PR number and per-PR cursor variables.
  - `filterByChangedFilesGraphQL(prs, includePaths, graphql)` that iterates until matched or files exhausted.
- Wire into `src/core.ts`:
  - Always use the PR-only path; if `include-paths` exists, run the GraphQL changed-files filter.
  - Proceed with `sortPullRequests` + `generateReleaseInfo` as today.
- Tests:
  - PR-only fetch path produces expected shape and ordering.
  - include-paths filtering yields correct inclusion/exclusion against mocked GraphQL files results (with pagination and early-exit).
  - New contributors tests remain green (separate batched search unchanged).

## Performance Expectations
- Commit history query eliminated.
- One GraphQL search (paginated) + batched GraphQL files queries for include-paths.
- Still significantly lighter than commit-history scans.

## Open Questions
- Default behavior when no previous release and very large history: adopt a sane default window or expose a `--from` flag. Start with a documentation-first approach.

## Next Steps
- Implement `fetchMergedPRs` and `filterByChangedFilesGraphQL` and integrate into `core.ts`.
- Update README with performance notes and include-paths behavior.
