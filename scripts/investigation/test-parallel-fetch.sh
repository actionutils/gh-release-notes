#!/bin/bash

# Test script for parallel fetching of PRs using GraphQL
# Usage: ./scripts/test-parallel-fetch.sh [owner/repo] [max_parallel]
# Example: ./scripts/test-parallel-fetch.sh cli/cli 5

set -e

REPO="${1:-actionutils/gh-release-notes}"
MAX_PARALLEL="${2:-5}"  # Maximum parallel requests

IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "Fetching merged PRs from $OWNER/$REPO_NAME..."
echo "Max parallel requests: $MAX_PARALLEL"
echo "---"

# First, get the total count with a minimal query
count_query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED) {
      totalCount
    }
  }
}'

echo "Getting total count..."
count_response=$(gh api graphql -f query="$count_query" -F owner="$OWNER" -F name="$REPO_NAME")
total_count=$(echo "$count_response" | jq -r '.data.repository.pullRequests.totalCount')

echo "Total merged PRs: $total_count"

if [ "$total_count" -eq 0 ]; then
  echo "No merged PRs found"
  exit 0
fi

# Calculate number of pages (100 items per page)
pages_needed=$(( (total_count + 99) / 100 ))
echo "Pages needed: $pages_needed (100 PRs per page)"
echo "---"

# GraphQL query for fetching PRs with cursor
pr_query='
query($owner: String!, $name: String!, $cursor: String, $first: Int!) {
  repository(owner: $owner, name: $name) {
    pullRequests(
      first: $first,
      after: $cursor,
      states: MERGED,
      orderBy: {field: UPDATED_AT, direction: DESC}
    ) {
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

# Create temp directory for parallel results
temp_dir=$(mktemp -d)
echo "Temp directory: $temp_dir"

# Function to fetch a single page
fetch_page() {
  local page_num=$1
  local cursor=$2
  local output_file="$temp_dir/page_${page_num}.json"

  if [ "$cursor" = "null" ]; then
    gh api graphql -f query="$pr_query" -F owner="$OWNER" -F name="$REPO_NAME" -F first=100 > "$output_file"
  else
    gh api graphql -f query="$pr_query" -F owner="$OWNER" -F name="$REPO_NAME" -F first=100 -F cursor="$cursor" > "$output_file"
  fi

  echo "✓ Fetched page $page_num"
}

# Start timer
start_time=$(date +%s)

# Fetch first page to get initial cursor
echo "Fetching pages in parallel..."
fetch_page 1 "null"

# If we need more pages, fetch them in parallel
if [ "$pages_needed" -gt 1 ]; then
  # Extract cursor from first page
  cursor=$(jq -r '.data.repository.pullRequests.pageInfo.endCursor' "$temp_dir/page_1.json")

  # Build list of remaining pages with their cursors
  page=2
  while [ "$page" -le "$pages_needed" ] && [ "$cursor" != "null" ]; do
    # Start background job if under parallel limit
    active_jobs=$(jobs -r | wc -l)
    while [ "$active_jobs" -ge "$MAX_PARALLEL" ]; do
      sleep 0.1
      active_jobs=$(jobs -r | wc -l)
    done

    # Fetch page in background
    fetch_page "$page" "$cursor" &

    # For sequential cursor calculation, we need to wait for the previous page
    # This is a limitation - we can't truly parallelize cursor-based pagination
    # But we can at least batch requests
    if [ "$page" -lt "$pages_needed" ]; then
      wait  # Wait for current batch to complete

      # Get the cursor from the last fetched page
      if [ -f "$temp_dir/page_${page}.json" ]; then
        cursor=$(jq -r '.data.repository.pullRequests.pageInfo.endCursor' "$temp_dir/page_${page}.json")
      fi
    fi

    page=$((page + 1))
  done

  # Wait for all background jobs to complete
  wait
fi

# End timer
end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo "---"
echo "All pages fetched in ${elapsed} seconds"
echo ""

# Process and combine results
echo "Processing results..."

# Combine all PRs into a single file
all_prs_file="$temp_dir/all_prs.json"
echo "[]" > "$all_prs_file"

for page in $(seq 1 "$pages_needed"); do
  page_file="$temp_dir/page_${page}.json"
  if [ -f "$page_file" ]; then
    jq '.data.repository.pullRequests.nodes[]' "$page_file" >> "$temp_dir/prs.jsonl"
  fi
done

# Sort PRs by mergedAt (since API doesn't support this directly)
if [ -f "$temp_dir/prs.jsonl" ]; then
  total_fetched=$(wc -l < "$temp_dir/prs.jsonl" | xargs)

  # Convert to proper JSON array and sort
  jq -s 'sort_by(.mergedAt)' "$temp_dir/prs.jsonl" > "$all_prs_file"

  # Get statistics
  authors=$(jq -r '.[] | select(.author != null) | .author.login' "$all_prs_file" | sort | uniq)
  author_count=$(echo "$authors" | wc -l | xargs)

  # Get bot authors
  bot_authors=$(echo "$authors" | grep '\[bot\]$' || true)
  if [ -n "$bot_authors" ]; then
    bot_count=$(echo "$bot_authors" | wc -l | xargs)
  else
    bot_count=0
  fi

  # Get date range
  first_pr_date=$(jq -r 'first | .mergedAt' "$all_prs_file")
  last_pr_date=$(jq -r 'last | .mergedAt' "$all_prs_file")

  echo "## Statistics"
  echo ""
  echo "- Total PRs fetched: $total_fetched"
  echo "- Unique contributors: $author_count"
  echo "- Bot contributors: $bot_count"
  echo "- Date range: ${first_pr_date:-N/A} to ${last_pr_date:-N/A}"
  echo ""

  # Show PRs by year
  echo "## PRs by Year"
  echo ""
  for year in $(jq -r '.[] | select(.mergedAt != null) | .mergedAt[0:4]' "$all_prs_file" | sort | uniq); do
    year_count=$(jq -r ".[] | select(.mergedAt != null) | select(.mergedAt | startswith(\"$year\")) | .number" "$all_prs_file" | wc -l | xargs)
    echo "- $year: $year_count PRs"
  done
  echo ""

  # Show sample of first contributors (oldest PRs)
  echo "## Sample of First Contributors (oldest 10)"
  echo ""

  seen_authors=""
  jq -r '.[] | select(.author != null) | "\(.number)|\(.author.login)|\(.mergedAt)"' "$all_prs_file" | \
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
fi

# Cleanup
rm -rf "$temp_dir"

echo ""
echo "## Performance"
echo "- Total pages: $pages_needed"
echo "- Max parallel: $MAX_PARALLEL"
echo "- Time elapsed: ${elapsed}s"
echo "- Avg time per page: $(( elapsed * 1000 / pages_needed ))ms"
