#!/bin/bash

# Test script for New Contributors feature - fetches all merged PRs with author info
# Usage: ./scripts/test-new-contributors.sh [owner/repo] [limit]
# Example: ./scripts/test-new-contributors.sh actionutils/gh-release-notes 500

set -e

REPO="${1:-actionutils/gh-release-notes}"
LIMIT="${2:-0}"  # 0 means fetch all

IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "Fetching merged PRs from $OWNER/$REPO_NAME..."
echo "Limit: ${LIMIT:-all}"
echo "---"

# GraphQL query to fetch merged PRs with minimal fields
query='
query($owner: String!, $name: String!, $cursor: String, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      first: $first,
      after: $cursor,
      states: MERGED,
      orderBy: {field: UPDATED_AT, direction: DESC}
    ) {
      totalCount
      nodes {
        number
        author {
          login
        }
        mergedAt
      }
      pageInfo {
        endCursor
        hasNextPage
      }
    }
  }
}'

# Initialize variables
cursor="null"
has_next=true
page=0
total_fetched=0
authors_set=""
pr_count=0

# Create temporary file for storing all PRs
temp_file=$(mktemp)
echo "[]" > "$temp_file"

# Fetch all pages
while [ "$has_next" = "true" ]; do
  page=$((page + 1))

  echo "Fetching page $page..."

  # Execute GraphQL query
  if [ "$cursor" = "null" ]; then
    response=$(gh api graphql -f query="$query" -F owner="$OWNER" -F name="$REPO_NAME" -F first=100)
  else
    response=$(gh api graphql -f query="$query" -F owner="$OWNER" -F name="$REPO_NAME" -F first=100 -F cursor="$cursor")
  fi

  # Extract data from response
  total_count=$(echo "$response" | jq -r '.data.repository.pullRequests.totalCount')

  # On first page, show total count
  if [ $page -eq 1 ]; then
    echo "Total merged PRs in repository: $total_count"
    echo "---"
  fi

  # Extract and append PRs to temp file
  echo "$response" | jq -c '.data.repository.pullRequests.nodes[]' >> "${temp_file}.prs"

  # Update pagination info
  cursor=$(echo "$response" | jq -r '.data.repository.pullRequests.pageInfo.endCursor')
  has_next=$(echo "$response" | jq -r '.data.repository.pullRequests.pageInfo.hasNextPage')

  # Count PRs fetched in this page
  page_count=$(echo "$response" | jq -r '.data.repository.pullRequests.nodes | length')
  total_fetched=$((total_fetched + page_count))

  echo "  Fetched: $page_count PRs (Total: $total_fetched)"

  # Check if we've reached the limit
  if [ "$LIMIT" -gt 0 ] && [ "$total_fetched" -ge "$LIMIT" ]; then
    echo "  Reached limit of $LIMIT PRs"
    break
  fi
done

echo "---"
echo "Fetch complete! Processing data..."
echo ""

# Process the PRs to find unique authors and statistics
if [ -f "${temp_file}.prs" ]; then
  # Get unique authors
  authors=$(cat "${temp_file}.prs" | jq -r 'select(.author != null) | .author.login' | sort | uniq)
  author_count=$(echo "$authors" | grep -c '^' || echo "0")

  # Get bot authors
  bot_authors=$(echo "$authors" | grep '\[bot\]$' || true)
  if [ -n "$bot_authors" ]; then
    bot_count=$(echo "$bot_authors" | wc -l | xargs)
  else
    bot_count=0
  fi

  # Get date range
  first_pr_date=$(cat "${temp_file}.prs" | jq -r 'select(.mergedAt != null) | .mergedAt' | sort | head -n1)
  last_pr_date=$(cat "${temp_file}.prs" | jq -r 'select(.mergedAt != null) | .mergedAt' | sort | tail -n1)

  # Count PRs by year
  echo "## Statistics"
  echo ""
  echo "- Total PRs fetched: $total_fetched"
  echo "- Unique contributors: $author_count"
  echo "- Bot contributors: $bot_count"
  echo "- Date range: ${first_pr_date:-N/A} to ${last_pr_date:-N/A}"
  echo ""

  echo "## PRs by Year"
  echo ""
  for year in $(cat "${temp_file}.prs" | jq -r 'select(.mergedAt != null) | .mergedAt[0:4]' | sort | uniq); do
    year_count=$(cat "${temp_file}.prs" | jq -r "select(.mergedAt != null) | select(.mergedAt | startswith(\"$year\")) | .number" | wc -l | xargs)
    echo "- $year: $year_count PRs"
  done
  echo ""

  # Show sample of recent contributors
  echo "## Sample of Recent Contributors (last 10 unique)"
  echo ""
  cat "${temp_file}.prs" | jq -r 'select(.author != null) | "\(.number)|\(.author.login)|\(.mergedAt)"' | head -20 | \
  while IFS='|' read -r pr_num author merged_at; do
    # Check if we've seen this author before
    if ! echo "$seen_authors" | grep -q "^$author$" 2>/dev/null; then
      echo "- @$author (PR #$pr_num, merged: ${merged_at:0:10})"
      seen_authors="$seen_authors$author"$'\n'
      count=$((${count:-0} + 1))
      if [ "${count:-0}" -ge 10 ]; then
        break
      fi
    fi
  done
  echo ""

  # Show bot accounts if any
  if [ "$bot_count" -gt 0 ]; then
    echo "## Bot Accounts Found"
    echo ""
    echo "$bot_authors" | while read -r bot; do
      [ -n "$bot" ] && echo "- @$bot"
    done
    echo ""
    echo "Note: Excluding bots could reduce dataset by ~$((bot_count * 100 / author_count))%"
  fi
fi

# Cleanup
rm -f "$temp_file" "${temp_file}.prs"

echo ""
echo "## Performance"
echo "- Pages fetched: $page"
echo "- API requests: $page"
echo "- Approximate time for full fetch: $((page * 2))s (at ~2s per request)"
