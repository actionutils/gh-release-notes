#!/bin/bash

# Script to check for new contributors by checking their commit or PR history
# Usage: ./scripts/investigation/check-new-contributors.sh [owner/repo] [days] [mode]
# Example: ./scripts/investigation/check-new-contributors.sh cli/cli 30 commits
# Example: ./scripts/investigation/check-new-contributors.sh cli/cli 30 prs

set -e

REPO="${1:-actionutils/gh-release-notes}"
DAYS="${2:-30}"  # Number of days to look back
MODE="${3:-commits}"  # "commits" or "prs"

IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "Checking new contributors for $OWNER/$REPO_NAME"
echo "Looking back: $DAYS days"
echo "Check mode: $MODE"
echo "---"

# Step 1: Get all contributors in the last N days (from PRs)
echo "Step 1: Getting contributors from merged PRs in last $DAYS days..."

# Calculate date N days ago
from_date=$(date -u -v-${DAYS}d '+%Y-%m-%dT%H:%M:%SZ' 2>/dev/null || date -u -d "$DAYS days ago" '+%Y-%m-%dT%H:%M:%SZ')
search_query="repo:${OWNER}/${REPO_NAME} is:pr is:merged merged:>${from_date}"

echo "From date: $from_date"
echo ""

# Get contributors in the date range from PRs
echo "Fetching PRs merged after $from_date..."

contributors_query='
query($searchQuery: String!, $cursor: String) {
  search(query: $searchQuery, type: ISSUE, first: 100, after: $cursor) {
    issueCount
    pageInfo {
      hasNextPage
      endCursor
    }
    nodes {
      ... on PullRequest {
        number
        author {
          login
        }
        mergedAt
      }
    }
  }
}'

# Collect all contributors
temp_file=$(mktemp)
cursor="null"
has_next="true"
total_prs=0

while [ "$has_next" = "true" ]; do
  if [ "$cursor" = "null" ]; then
    response=$(gh api graphql -f query="$contributors_query" -F searchQuery="$search_query")
  else
    response=$(gh api graphql -f query="$contributors_query" -F searchQuery="$search_query" -F cursor="$cursor")
  fi

  # On first page, get total count
  if [ "$cursor" = "null" ]; then
    total_prs=$(echo "$response" | jq -r '.data.search.issueCount')
    echo "Total merged PRs in last $DAYS days: $total_prs"
  fi

  # Save contributors and their first PR in this release
  echo "$response" | jq -r '.data.search.nodes[] | select(.author.login != null) | "\(.author.login)|\(.number)|\(.mergedAt)"' >> "$temp_file"

  has_next=$(echo "$response" | jq -r '.data.search.pageInfo.hasNextPage')
  cursor=$(echo "$response" | jq -r '.data.search.pageInfo.endCursor')
done

# Get unique contributors and their first PR in this period
contributors=$(cat "$temp_file" | sort -t'|' -k1,1 -k3,3 | awk -F'|' '!seen[$1]++ {print}')
contributor_count=$(echo "$contributors" | wc -l | xargs)

echo "Found $contributor_count unique contributors"

if [ "$contributor_count" -eq 0 ]; then
  echo "No contributors found in the last $DAYS days."
  rm -f "$temp_file"
  exit 0
fi

echo ""

# Step 2: Batch check each contributor's history
if [ "$MODE" = "commits" ]; then
  echo "Step 2: Checking each contributor's COMMIT history (batched)..."
else
  echo "Step 2: Checking each contributor's PR history (batched)..."
fi
echo ""

# Create file for new contributors
new_contributors_file=$(mktemp)

# Process contributors in batches of up to 10
batch_size=10
batch_num=0

# Read contributors into array (compatible with macOS)
contributor_array=()
while IFS= read -r line; do
  if [ -n "$line" ]; then
    contributor_array+=("$line")
  fi
done <<< "$contributors"

# Process in batches
for ((i=0; i<${#contributor_array[@]}; i+=batch_size)); do
  batch_num=$((batch_num + 1))

  # Get batch of contributors
  batch_end=$((i + batch_size))
  if [ $batch_end -gt ${#contributor_array[@]} ]; then
    batch_end=${#contributor_array[@]}
  fi

  # Build dynamic GraphQL query with aliases
  query="query {"

  for ((j=i; j<batch_end; j++)); do
    contributor="${contributor_array[$j]}"
    if [ -z "$contributor" ]; then
      continue
    fi

    author=$(echo "$contributor" | cut -d'|' -f1)
    pr_num=$(echo "$contributor" | cut -d'|' -f2)
    merged_at=$(echo "$contributor" | cut -d'|' -f3)

    # Create safe alias (replace special chars, prefix with 'u_' to ensure valid GraphQL field)
    alias="u_$(echo "$author" | tr -d '[]' | tr '-' '_' | tr '.' '_')"

    if [ "$MODE" = "commits" ]; then
      # For commits, we'll check individually using gh CLI
      # (GraphQL search doesn't support type: COMMIT)
      continue
    else
      # Check for PRs (original behavior)
      query="$query
      ${alias}: search(query: \"repo:${OWNER}/${REPO_NAME} is:pr is:merged author:${author}\", type: ISSUE, first: 2) {
        issueCount
        nodes {
          ... on PullRequest {
            number
            mergedAt
          }
        }
      }"
    fi
  done

  query="$query
  }"

  batch_size_actual=$((batch_end - i))
  echo "[Batch $batch_num] Checking $batch_size_actual contributors..."

  # Execute batch query
  response=$(gh api graphql -f query="$query" 2>/dev/null || echo "{}")

  # Process results
  for ((j=i; j<batch_end; j++)); do
    contributor="${contributor_array[$j]}"
    if [ -z "$contributor" ]; then
      continue
    fi

    author=$(echo "$contributor" | cut -d'|' -f1)
    pr_num=$(echo "$contributor" | cut -d'|' -f2)
    merged_at=$(echo "$contributor" | cut -d'|' -f3)
    alias="u_$(echo "$author" | tr -d '[]' | tr '-' '_' | tr '.' '_')"

    if [ "$MODE" = "commits" ]; then
      # Check if user has any commits using gh CLI
      commit_count=$(gh search commits --repo "${OWNER}/${REPO_NAME}" --author "$author" --limit 1 --json sha 2>/dev/null | jq '. | length')

      if [ "$commit_count" -eq 0 ]; then
        # No commits found - this is their first contribution
        echo "  ✨ NEW: @$author (no prior commits, first PR: #$pr_num)"
        echo "$author|$pr_num|$merged_at" >> "$new_contributors_file"
      else
        echo "  ✓ EXISTING: @$author (has commits in repo)"
      fi
    else
      # Check PR count (original logic)
      pr_count=$(echo "$response" | jq -r ".data.${alias}.issueCount // 0")

      if [ "$pr_count" -eq 1 ]; then
        # This is their first PR
        echo "  ✨ NEW: @$author (first PR: #$pr_num)"
        echo "$author|$pr_num|$merged_at" >> "$new_contributors_file"
      elif [ "$pr_count" -eq 0 ]; then
        echo "  ⚠️  WARNING: Could not verify @$author (PR #$pr_num)"
      else
        # They have previous PRs - check if current PR is actually their first
        first_pr_num=$(echo "$response" | jq -r ".data.${alias}.nodes | sort_by(.mergedAt) | .[0].number // 0")

        if [ "$first_pr_num" = "$pr_num" ]; then
          # Current PR is actually their first
          echo "  ✨ NEW: @$author (first PR: #$pr_num)"
          echo "$author|$pr_num|$merged_at" >> "$new_contributors_file"
        else
          echo "  ✓ EXISTING: @$author (has $pr_count total PRs, first was #$first_pr_num)"
        fi
      fi
    fi
  done

  echo ""
done

echo "---"
echo "## Summary"
echo ""

# Count new contributors
if [ -f "$new_contributors_file" ] && [ -s "$new_contributors_file" ]; then
  new_count=$(wc -l < "$new_contributors_file" | xargs)

  if [ "$MODE" = "commits" ]; then
    echo "Found $new_count new contributors (no prior commits) in the last $DAYS days:"
  else
    echo "Found $new_count new contributors in the last $DAYS days:"
  fi
  echo ""

  while IFS='|' read -r author pr_num merged_at; do
    echo "* @$author made their first contribution in https://github.com/$OWNER/$REPO_NAME/pull/$pr_num"
  done < "$new_contributors_file"
else
  echo "No new contributors found in the last $DAYS days."
fi

# Cleanup
rm -f "$temp_file" "$new_contributors_file"

echo ""
echo "## Performance Notes"
echo "- Checked $contributor_count contributors in $batch_num batch(es)"
if [ "$MODE" = "commits" ]; then
  echo "- Mode: Checking for any prior COMMITS (most accurate for first-time contributors)"
else
  echo "- Mode: Checking for prior merged PRs"
fi
echo "- API requests: ~$(( batch_num + (total_prs + 99) / 100 )) total (fetching + checking)"
