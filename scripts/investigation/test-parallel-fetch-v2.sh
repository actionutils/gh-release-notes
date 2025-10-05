#!/bin/bash

# Test script for TRUE parallel fetching of PRs using PR number ranges
# Usage: ./scripts/test-parallel-fetch-v2.sh [owner/repo] [max_parallel]
# Example: ./scripts/test-parallel-fetch-v2.sh cli/cli 5

set -e

REPO="${1:-actionutils/gh-release-notes}"
MAX_PARALLEL="${2:-5}"  # Maximum parallel requests

IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "Fetching merged PRs from $OWNER/$REPO_NAME..."
echo "Max parallel requests: $MAX_PARALLEL"
echo "---"

# First, get repository info including total PR count and latest PR number
info_query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(states: MERGED) {
      totalCount
    }
    latestPR: pullRequests(first: 1, orderBy: {field: CREATED_AT, direction: DESC}) {
      nodes {
        number
      }
    }
  }
}'

echo "Getting repository info..."
info_response=$(gh api graphql -f query="$info_query" -F owner="$OWNER" -F name="$REPO_NAME")
total_count=$(echo "$info_response" | jq -r '.data.repository.pullRequests.totalCount')
latest_pr=$(echo "$info_response" | jq -r '.data.repository.latestPR.nodes[0].number')

echo "Total merged PRs: $total_count"
echo "Latest PR number: $latest_pr"

if [ "$total_count" -eq 0 ]; then
  echo "No merged PRs found"
  exit 0
fi

# Calculate PR ranges for parallel fetching
# Divide the PR number space into chunks
chunk_size=$(( (latest_pr + MAX_PARALLEL - 1) / MAX_PARALLEL ))
echo "PR range chunk size: ~$chunk_size PRs per worker"
echo "---"

# GraphQL query for fetching PRs by number range using search
# This allows true parallel fetching since we don't need cursors
search_query='
query($searchQuery: String!, $first: Int!, $cursor: String) {
  search(query: $searchQuery, type: ISSUE, first: $first, after: $cursor) {
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
        state
      }
    }
  }
}'

# Create temp directory for parallel results
temp_dir=$(mktemp -d)
echo "Temp directory: $temp_dir"

# Function to fetch PRs in a number range
fetch_range() {
  local worker_id=$1
  local start_pr=$2
  local end_pr=$3
  local output_file="$temp_dir/range_${worker_id}.jsonl"

  # Build search query for this range
  local search="repo:${OWNER}/${REPO_NAME} is:pr is:merged ${start_pr}..${end_pr}"

  echo "[Worker $worker_id] Fetching PRs #${start_pr}-${end_pr}..."

  local cursor="null"
  local has_next="true"
  local page=0

  while [ "$has_next" = "true" ]; do
    page=$((page + 1))

    # Execute search query
    if [ "$cursor" = "null" ]; then
      response=$(gh api graphql -f query="$search_query" -F searchQuery="$search" -F first=100 2>/dev/null || echo "{}")
    else
      response=$(gh api graphql -f query="$search_query" -F searchQuery="$search" -F first=100 -F cursor="$cursor" 2>/dev/null || echo "{}")
    fi

    # Extract and save PRs
    echo "$response" | jq -c '.data.search.nodes[] | select(.mergedAt != null)' >> "$output_file" 2>/dev/null || true

    # Check for next page
    has_next=$(echo "$response" | jq -r '.data.search.pageInfo.hasNextPage // false')
    cursor=$(echo "$response" | jq -r '.data.search.pageInfo.endCursor // null')

    if [ "$page" -gt 10 ]; then
      # Safety limit to prevent infinite loops
      break
    fi
  done

  local count=$(wc -l < "$output_file" 2>/dev/null | xargs || echo "0")
  echo "[Worker $worker_id] ✓ Fetched $count merged PRs from range #${start_pr}-${end_pr}"
}

# Start timer
start_time=$(date +%s)

echo "Starting parallel fetch with $MAX_PARALLEL workers..."
echo ""

# Launch parallel workers
for i in $(seq 1 "$MAX_PARALLEL"); do
  start_pr=$(( (i - 1) * chunk_size + 1 ))
  end_pr=$(( i * chunk_size ))

  # Last worker takes remaining PRs
  if [ "$i" -eq "$MAX_PARALLEL" ]; then
    end_pr=$latest_pr
  fi

  # Skip if range is invalid
  if [ "$start_pr" -gt "$latest_pr" ]; then
    continue
  fi

  # Launch worker in background
  fetch_range "$i" "$start_pr" "$end_pr" &
done

# Wait for all workers to complete
wait

# End timer
end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo ""
echo "All workers completed in ${elapsed} seconds"
echo "---"

# Process and combine results
echo "Processing results..."

# Combine all PRs into a single file
all_prs_file="$temp_dir/all_prs.json"

# Merge all JSONL files and sort by mergedAt
cat "$temp_dir"/range_*.jsonl 2>/dev/null | jq -s 'unique_by(.number) | sort_by(.mergedAt)' > "$all_prs_file" || echo "[]" > "$all_prs_file"

# Get statistics
if [ -f "$all_prs_file" ]; then
  total_fetched=$(jq 'length' "$all_prs_file")

  if [ "$total_fetched" -gt 0 ]; then
    # Get unique authors
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
    first_pr_date=$(jq -r 'first | .mergedAt // "N/A"' "$all_prs_file")
    last_pr_date=$(jq -r 'last | .mergedAt // "N/A"' "$all_prs_file")

    echo ""
    echo "## Statistics"
    echo ""
    echo "- Total PRs fetched: $total_fetched"
    echo "- Unique contributors: $author_count"
    echo "- Bot contributors: $bot_count"
    echo "- Date range: ${first_pr_date:0:10} to ${last_pr_date:0:10}"
    echo ""

    # Show PRs by year
    echo "## PRs by Year"
    echo ""
    for year in $(jq -r '.[] | select(.mergedAt != null) | .mergedAt[0:4]' "$all_prs_file" | sort | uniq); do
      year_count=$(jq "[.[] | select(.mergedAt | startswith(\"$year\"))] | length" "$all_prs_file")
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
    echo ""

    # Show bot accounts if any
    if [ "$bot_count" -gt 0 ]; then
      echo "## Bot Accounts Found"
      echo ""
      echo "$bot_authors" | while read -r bot; do
        [ -n "$bot" ] && echo "- @$bot"
      done
      echo ""
      percentage=$(( bot_count * 100 / author_count ))
      echo "Note: Excluding bots could reduce dataset by ~${percentage}%"
    fi
  else
    echo "No PRs found in fetched data"
  fi
fi

# Cleanup
rm -rf "$temp_dir"

echo ""
echo "## Performance"
echo "- Workers used: $MAX_PARALLEL"
echo "- Time elapsed: ${elapsed}s"
echo "- Avg time per worker: $(( elapsed * 1000 / MAX_PARALLEL ))ms"
echo ""
echo "Note: This uses search API which has a 1000 result limit per query."
echo "For repos with >1000 PRs in a range, consider smaller chunks or date-based queries."
