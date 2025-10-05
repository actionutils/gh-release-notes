# Design Document: New Contributors Feature

## Overview

This document outlines the design for implementing a "New Contributors" section in gh-release-notes, similar to GitHub's official Release Note generation API. This feature will identify and list users who made their first contribution to the repository in the current release.

## Problem Statement

GitHub's official Release Note generation API includes a "New Contributors" section that shows users who made their first contribution with links to their PRs. However, the author association field (`authorAssociation`) changes from `FIRST_TIME_CONTRIBUTOR` to `CONTRIBUTOR` after a PR is merged, making it impossible to determine first-time contributors using this field at release note generation time.

## Proposed Solution

### Core Approach (Recommended)

**Batch Contributor Checking**: Instead of fetching ALL historical PRs upfront:

1. Get all contributors who have PRs in the current release (already available in gh-release-notes)
2. For each contributor, check if they have previous contributions using batched queries
3. Mark as new contributor based on the check results
4. Generate the New Contributors section with appropriate formatting

**Key Advantages**:
- **Efficient**: Only queries for active contributors in the release (typically 10-100)
- **Fast**: Batch checking 10 contributors per GraphQL request
- **Scalable**: Performance scales with release size, not repository age
- **Flexible**: Can check either commits or PRs based on requirements
- **Accurate**: Uses actual repository history and handles bot accounts properly

### Implementation Details

#### 1. Data Collection Strategy

**Step 1: Get Release Contributors**
- Use existing contributor list from gh-release-notes
- PR authors already available from the release period
- Include `__typename` field to identify Bot accounts
- Typically 10-100 contributors per release

**Step 2: Batch Check Contributor History**

Two checking modes available:

**Option A: Check for prior commits** (Most accurate for true first-time contributors)
```bash
# Using gh CLI to check if user has any commits
gh search commits --repo owner/repo --author USERNAME --limit 1
```
- If no commits found → true first-time contributor
- Most accurate but requires individual API calls per contributor

**Option B: Check for prior PRs** (Recommended for performance)
```graphql
# Batch check multiple contributors in one GraphQL query
query {
  user1: search(query: "repo:owner/repo is:pr is:merged author:user1", type: ISSUE, first: 2) {
    issueCount
    nodes { ... on PullRequest { number, mergedAt } }
  }
  user2: search(query: "repo:owner/repo is:pr is:merged author:user2[bot]", type: ISSUE, first: 2) {
    issueCount
    nodes { ... on PullRequest { number, mergedAt } }
  }
  # ... up to 10 users per query
}
```
- Check if `issueCount` > current release PRs
- Process in batches of 10 contributors
- Much faster than commit checking

#### 2. Bot Account Handling

**Critical Discovery**: Bot accounts require special handling in GitHub's search API.

```graphql
# Fetch PR with author __typename
query {
  repository(owner: "owner", name: "repo") {
    pullRequest(number: 123) {
      author {
        login         # e.g., "github-actions"
        __typename    # "User" or "Bot"
      }
    }
  }
}
```

**Implementation**:
1. Always fetch `__typename` along with `login`
2. If `__typename === "Bot"`, append `[bot]` suffix when searching:
   - Bot login: `github-actions`
   - Search query: `author:github-actions[bot]`
3. This ensures accurate PR/commit history for bot accounts

See implementation: [`scripts/investigation/test-batch-contributors.sh`](../scripts/investigation/test-batch-contributors.sh#L141-L146)

#### 3. Algorithm for Batch Checking

```javascript
// Pseudocode for the batch checking algorithm
function checkNewContributors(releaseContributors) {
  const newContributors = []

  // Process in batches of 10 for efficiency
  for (const batch of chunk(releaseContributors, 10)) {
    const query = buildBatchQuery(batch)
    const results = await graphqlQuery(query)

    for (const contributor of batch) {
      const prCount = results[contributor.alias].issueCount

      if (prCount === 1) {
        // Only 1 PR total = new contributor
        newContributors.push(contributor)
      } else if (prCount > 1) {
        // Check if current PR is actually their first
        const firstPR = results[contributor.alias].nodes[0]
        if (firstPR.number === contributor.currentPR.number) {
          newContributors.push(contributor)
        }
      }
    }
  }

  return newContributors
}
```

#### 4. Template Integration

```markdown
## What's Changed
$PULL_REQUESTS

## New Contributors
$NEW_CONTRIBUTORS

**Full Changelog**: $CHANGELOG_URL
```

Generated output:
```markdown
## New Contributors
* @username made their first contribution in https://github.com/org/repo/pull/123
* @another-user made their first contribution in https://github.com/org/repo/pull/456
```

#### 5. JSON Output Structure

```json
{
  "tag": "v1.0.0",
  "previousTag": "v0.9.0",
  "pullRequests": [...],
  "newContributors": [
    {
      "login": "username",
      "isBot": false,
      "firstPullRequest": {
        "number": 123,
        "title": "Add new feature",
        "url": "https://github.com/org/repo/pull/123"
      }
    }
  ]
}
```

## Performance Analysis

### Real-World Test Results

| Repository | Contributors | PRs Checked | API Requests | Time | Mode |
|------------|-------------|-------------|--------------|------|------|
| cli/cli | 7 | 7 | 2 | <1s | PR check |
| cli/cli | 15 | 15 | 3 | ~1s | PR check (60 days) |
| facebook/react | 57 | 57 | 6 | ~2s | PR check (200 days) |
| actionutils/gh-release-notes | 2 | 2 | 1 | <1s | PR check |

### Performance Characteristics

- **API Requests**: `⌈contributors / 10⌉ + ⌈PRs / 100⌉`
- **Time Complexity**: O(contributors) with batching
- **Memory Usage**: Minimal (only current release data)
- **Scalability**: Excellent (scales with release size, not repo history)

### Comparison with Alternative Approaches

| Approach | API Requests | Time | Pros | Cons |
|----------|-------------|------|------|------|
| **Batch Check** (Recommended) | 1-50 | 1-5s | Fast, efficient, scalable | - |
| Full History Fetch | 100-1000s | 10-60s | Complete history | Very slow, high API usage |
| Parallel Date Ranges | 10-100 | 5-20s | Good for large repos | Complex, search API limits |
| Sequential Cursor | 50-500 | 20-60s | No search limits | Slow for old repos |

## Implementation Considerations

### Edge Cases

1. **Bot Accounts**: Must use `__typename` to detect and add `[bot]` suffix
2. **Deleted Users**: Handle null author gracefully
3. **Usernames with Numbers**: Prefix GraphQL aliases with `u_` (e.g., `0xFANGO` → `u_0xFANGO`)
4. **Rate Limiting**: Implement exponential backoff
5. **Large Releases**: May need to increase batch size or parallelize

### Configuration Options

```yaml
# CLI flags
--include-new-contributors  # Enable when not using template

# Template placeholders
$NEW_CONTRIBUTORS           # Triggers new contributor detection
```

## Investigation Scripts

All investigation scripts are located in [`scripts/investigation/`](../scripts/investigation/):

1. **[`check-new-contributors.sh`](../scripts/investigation/check-new-contributors.sh)**
   - Main investigation script with both modes
   - Usage: `./check-new-contributors.sh [repo] [days] [commits|prs]`
   - Supports both commit and PR checking

2. **[`test-batch-contributors.sh`](../scripts/investigation/test-batch-contributors.sh)**
   - Production-ready PR checking with bot handling
   - Usage: `./test-batch-contributors.sh [repo] [days]`
   - Properly handles bot accounts using `__typename`

3. **[`test-parallel-date.sh`](../scripts/investigation/test-parallel-date.sh)**
   - Alternative approach using date-based parallelization
   - Good for understanding full repository history
   - Not recommended for production due to complexity

4. **[`test-new-contributors.sh`](../scripts/investigation/test-new-contributors.sh)**
   - Simple sequential approach for comparison
   - Useful for small repositories

## Key Findings from Investigation

1. **Bot Account Discovery**: GitHub's search API requires `[bot]` suffix for bot accounts, but the `login` field doesn't include it. Must check `__typename === "Bot"` to detect bots.

2. **Commit vs PR Checking**:
   - Commit checking is more accurate (true first-time contributors)
   - PR checking is more efficient (batch queries possible)
   - Results can differ (someone might have commits but no merged PRs)

3. **Performance Optimization**: Batching 10 contributors per GraphQL query provides optimal balance between API efficiency and query complexity.

4. **Search API Limitations**: The search API has a 1000 result limit, but this isn't an issue for our approach since we only check individual contributors.

## Recommendations

1. **Use PR checking mode** for production (better performance)
2. Always fetch `__typename` to properly handle bot accounts
3. **Batch in groups of 10** for optimal API usage
4. **Implement as opt-in feature** via template placeholder
5. **Cache results** within a release generation session (not across sessions)

## Future Enhancements

1. Support for co-authors as new contributors
2. Configurable bot exclusion patterns
3. Different output formats (e.g., grouped by contribution type)
4. WebHook integration for real-time tracking
5. Historical contributor statistics

## Security Considerations

- No sensitive data is collected or stored
- Uses existing GitHub authentication
- Respects API rate limits
- No additional permissions required

## Conclusion

The batch contributor checking approach provides an efficient, scalable solution for identifying new contributors. With proper bot handling and batching, it achieves excellent performance (1-5 seconds for typical releases) while maintaining accuracy. The investigation scripts demonstrate the superiority of this approach over alternatives and provide a solid foundation for implementation.
