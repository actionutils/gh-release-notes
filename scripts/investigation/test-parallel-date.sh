#!/bin/bash

# Test script for parallel fetching using date ranges
# Fetches ALL PRs from repository history with max parallel workers
# Usage: ./scripts/test-parallel-date.sh [owner/repo] [max_parallel]
# Example: ./scripts/test-parallel-date.sh cli/cli 5

set -e

REPO="${1:-actionutils/gh-release-notes}"
MAX_PARALLEL="${2:-5}"  # Maximum parallel requests

IFS='/' read -r OWNER REPO_NAME <<< "$REPO"

echo "Fetching ALL merged PRs from $OWNER/$REPO_NAME..."
echo "Max parallel requests: $MAX_PARALLEL"
echo "---"

# Get current year and month
current_year=$(date +%Y)
current_month=$(date +%m)

# Create temp directory
temp_dir=$(mktemp -d)
echo "Temp directory: $temp_dir"

# Function to fetch PRs for a specific date range
fetch_date_range() {
  local worker_id=$1
  local date_range=$2
  local output_file="$temp_dir/worker_${worker_id}.jsonl"

  echo "[Worker $worker_id] Fetching PRs merged in: $date_range"

  # Use search API with date range
  local search_query="repo:${OWNER}/${REPO_NAME} is:pr is:merged merged:${date_range}"

  # GraphQL query
  local query='
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
          state
        }
      }
    }
  }'

  local cursor="null"
  local has_next="true"
  local total=0

  while [ "$has_next" = "true" ]; do
    # Execute query
    if [ "$cursor" = "null" ]; then
      response=$(gh api graphql -f query="$query" -F searchQuery="$search_query" 2>/dev/null || echo "{}")
    else
      response=$(gh api graphql -f query="$query" -F searchQuery="$search_query" -F cursor="$cursor" 2>/dev/null || echo "{}")
    fi

    # Save PRs
    echo "$response" | jq -c '.data.search.nodes[] | select(.mergedAt != null)' >> "$output_file" 2>/dev/null || true

    # Get issue count on first request
    if [ "$cursor" = "null" ]; then
      local count=$(echo "$response" | jq -r '.data.search.issueCount // 0')
      if [ "$count" -gt 1000 ]; then
        echo "[Worker $worker_id] WARNING: ${count} PRs found but API limit is 1000"
      fi
    fi

    # Update pagination
    has_next=$(echo "$response" | jq -r '.data.search.pageInfo.hasNextPage // false')
    cursor=$(echo "$response" | jq -r '.data.search.pageInfo.endCursor // null')
  done

  local fetched=$(wc -l < "$output_file" 2>/dev/null | xargs || echo "0")
  echo "[Worker $worker_id] ✓ Fetched $fetched PRs from $date_range"
}

# First, get the date range of the repository
echo "Getting repository age..."

# Get the first PR to determine repository age
first_pr_query='
query($owner: String!, $name: String!) {
  repository(owner: $owner, name: $name) {
    pullRequests(first: 1, states: MERGED, orderBy: {field: CREATED_AT, direction: ASC}) {
      nodes {
        createdAt
        mergedAt
      }
    }
  }
}'

first_pr_response=$(gh api graphql -f query="$first_pr_query" -F owner="$OWNER" -F name="$REPO_NAME")
first_pr_date=$(echo "$first_pr_response" | jq -r '.data.repository.pullRequests.nodes[0].mergedAt // .data.repository.pullRequests.nodes[0].createdAt // null')

if [ "$first_pr_date" = "null" ] || [ -z "$first_pr_date" ]; then
  echo "No merged PRs found or unable to determine repository age"
  exit 0
fi

first_year=$(echo "$first_pr_date" | cut -d'-' -f1)
echo "First merged PR year: $first_year"
echo "Repository spans: $first_year to $current_year"
echo ""

# Build date ranges for parallel processing
echo "Building date ranges for parallel fetching..."

date_ranges=()

# Create year ranges from first PR year to current year
for year in $(seq "$first_year" "$current_year"); do
  date_ranges+=("${year}-01-01..${year}-12-31")
done

echo "Date ranges: ${#date_ranges[@]} total (all years from $first_year to $current_year)"
echo "---"

# Start timer
start_time=$(date +%s)

echo "Starting parallel fetch with max $MAX_PARALLEL workers..."
echo ""

# Launch workers in parallel, but limit to MAX_PARALLEL concurrent
worker_id=0
for range in "${date_ranges[@]}"; do
  worker_id=$((worker_id + 1))

  # Limit concurrent workers
  while [ $(jobs -r | wc -l) -ge "$MAX_PARALLEL" ]; do
    sleep 0.1
  done

  fetch_date_range "$worker_id" "$range" &
done

# Wait for all remaining workers
wait

# End timer
end_time=$(date +%s)
elapsed=$((end_time - start_time))

echo ""
echo "All workers completed in ${elapsed} seconds"
echo "---"

# Process results
echo "Processing results..."

# Combine and sort all PRs
all_prs_file="$temp_dir/all_prs.json"
cat "$temp_dir"/worker_*.jsonl 2>/dev/null | \
  jq -s 'unique_by(.number) | sort_by(.mergedAt)' > "$all_prs_file" || echo "[]" > "$all_prs_file"

# Get statistics
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
  for year in $(jq -r '.[] | .mergedAt[0:4]' "$all_prs_file" | sort | uniq); do
    year_count=$(jq "[.[] | select(.mergedAt | startswith(\"$year\"))] | length" "$all_prs_file")
    echo "- $year: $year_count PRs"
  done
  echo ""

  # Show first contributors
  echo "## Sample of First Contributors (oldest 10)"
  echo ""

  seen_authors=""
  jq -r '.[] | "\(.number)|\(.author.login // "null")|\(.mergedAt)"' "$all_prs_file" | \
  while IFS='|' read -r pr_num author merged_at; do
    if [ "$author" != "null" ]; then
      if ! echo "$seen_authors" | grep -q "^$author$" 2>/dev/null; then
        echo "- @$author (PR #$pr_num, merged: ${merged_at:0:10})"
        seen_authors="$seen_authors$author"$'\n'
        count=$((${count:-0} + 1))
        if [ "${count:-0}" -ge 10 ]; then
          break
        fi
      fi
    fi
  done
  echo ""

  # Show bot accounts
  if [ "$bot_count" -gt 0 ]; then
    echo "## Bot Accounts"
    echo ""
    echo "$bot_authors" | while read -r bot; do
      [ -n "$bot" ] && echo "- @$bot"
    done
    percentage=$(( bot_count * 100 / author_count ))
    echo ""
    echo "Bot accounts: ${percentage}% of contributors"
  fi
else
  echo "No PRs found"
fi

# Cleanup
rm -rf "$temp_dir"

echo ""
echo "## Performance"
echo "- Date ranges processed: ${#date_ranges[@]} (years: $first_year-$current_year)"
echo "- Max parallel workers: $MAX_PARALLEL"
echo "- Time elapsed: ${elapsed}s"
echo ""
echo "Note: Search API limits results to 1000 per query."
echo "If a year has >1000 merged PRs, consider splitting into smaller ranges (quarters/months)."
