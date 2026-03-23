#!/usr/bin/env bash
# review-pr.sh — fetch CodeRabbit comments on a PR and provide reply helpers
#
# Usage: scripts/review-pr.sh <PR_NUMBER> [command] [args...]
#
# Commands (no command = dump all CodeRabbit comments for Claude to read):
#   dump                      — print all CodeRabbit comments as JSON (default)
#   wait                      — poll until CodeRabbit has posted a review (max 10 min)
#   reply-inline  <id> <msg>  — post a threaded reply to an inline review comment
#   reply-pr      <msg>       — post a PR-level issue comment (no threading)
#   merge                     — squash-merge the PR and delete the branch
#   sync                      — git pull origin main on current branch
#
# Examples:
#   scripts/review-pr.sh 7 wait
#   scripts/review-pr.sh 7 dump
#   scripts/review-pr.sh 7 reply-inline 123456789 "Working on it."
#   scripts/review-pr.sh 7 reply-inline 123456789 "Fixed in abc1234."
#   scripts/review-pr.sh 7 reply-inline 123456789 "Disagree: pathlib normalises trailing slashes in Python 3.12."
#   scripts/review-pr.sh 7 reply-pr "All comments addressed."
#   scripts/review-pr.sh 7 merge
#
# Requirements: gh CLI authenticated as karthiknitt, jq

set -euo pipefail

PR="${1:?Usage: $0 <PR_NUMBER> [command] [args...]}"
CMD="${2:-dump}"
REPO="karthiknitt/photomind"
BOT_LOGIN="coderabbitai[bot]"

# ---------------------------------------------------------------------------
# wait — poll until CodeRabbit posts its review (up to 10 minutes)
# ---------------------------------------------------------------------------
cmd_wait() {
  echo "==> Waiting for CodeRabbit review on PR #$PR (timeout: 10 min)..."
  local deadline=$(( $(date +%s) + 600 ))
  while [[ $(date +%s) -lt $deadline ]]; do
    local found
    found=$(gh api "repos/$REPO/pulls/$PR/reviews" \
      --jq "[.[] | select(.user.login == \"$BOT_LOGIN\")] | length")
    if [[ "$found" -gt 0 ]]; then
      echo "==> CodeRabbit review detected."
      return 0
    fi
    echo "    ... not yet (checking again in 30s)"
    sleep 30
  done
  echo "ERROR: Timed out waiting for CodeRabbit review." >&2
  exit 1
}

# ---------------------------------------------------------------------------
# dump — print all CodeRabbit inline + PR-level comments as readable JSON
# ---------------------------------------------------------------------------
cmd_dump() {
  echo "==> Fetching CodeRabbit inline review comments on PR #$PR..."
  echo ""
  echo "--- INLINE REVIEW COMMENTS (use reply-inline <id> <msg> to reply) ---"
  gh api "repos/$REPO/pulls/$PR/comments" \
    --jq "[.[] | select(.user.login == \"$BOT_LOGIN\") | {id, path, line, body}]"

  echo ""
  echo "--- PR-LEVEL COMMENTS (use reply-pr <msg> to reply) ---"
  gh api "repos/$REPO/issues/$PR/comments" \
    --jq "[.[] | select(.user.login == \"$BOT_LOGIN\") | {id, body}]"

  echo ""
  echo "--- REVIEW SUMMARY (full body from CodeRabbit walkthrough) ---"
  gh api "repos/$REPO/pulls/$PR/reviews" \
    --jq "[.[] | select(.user.login == \"$BOT_LOGIN\") | {id, state, submitted_at, body}]"
}

# ---------------------------------------------------------------------------
# reply-inline — post a threaded reply to an inline review comment
# ---------------------------------------------------------------------------
cmd_reply_inline() {
  local comment_id="${3:?Usage: $0 $PR reply-inline <comment_id> <message>}"
  local message="${4:?Usage: $0 $PR reply-inline <comment_id> <message>}"

  echo "==> Replying to inline comment #$comment_id on PR #$PR..."
  gh api "repos/$REPO/pulls/$PR/comments" \
    --method POST \
    -f "body=$message" \
    -F "in_reply_to=$comment_id"
  echo "==> Reply posted."
}

# ---------------------------------------------------------------------------
# reply-pr — post a PR-level comment (issue comment, no threading)
# ---------------------------------------------------------------------------
cmd_reply_pr() {
  local message="${3:?Usage: $0 $PR reply-pr <message>}"

  echo "==> Posting PR-level comment on PR #$PR..."
  gh api "repos/$REPO/issues/$PR/comments" \
    --method POST \
    -f "body=$message"
  echo "==> Comment posted."
}

# ---------------------------------------------------------------------------
# merge — squash-merge PR and delete branch
# ---------------------------------------------------------------------------
cmd_merge() {
  echo "==> Merging PR #$PR (squash, delete branch)..."

  # Ensure branch is up to date with main first
  local branch
  branch=$(gh pr view "$PR" --repo "$REPO" --json headRefName --jq '.headRefName')
  echo "    Branch: $branch"

  # Check for conflicts
  local mergeable
  mergeable=$(gh pr view "$PR" --repo "$REPO" --json mergeable --jq '.mergeable')
  if [[ "$mergeable" == "CONFLICTING" ]]; then
    echo "ERROR: PR #$PR has merge conflicts. Resolve them first." >&2
    echo "  Hint: git fetch origin main && git merge origin/main --no-edit" >&2
    echo "  For uv.lock conflicts: git checkout --theirs uv.lock && uv sync" >&2
    exit 1
  fi

  gh pr merge "$PR" --repo "$REPO" --squash --delete-branch
  echo "==> PR #$PR merged and branch deleted."
}

# ---------------------------------------------------------------------------
# sync — pull latest main into current local branch
# ---------------------------------------------------------------------------
cmd_sync() {
  echo "==> Syncing local main with origin..."
  git checkout main
  git pull origin main
  echo "==> Local main is up to date."
}

# ---------------------------------------------------------------------------
# dispatch
# ---------------------------------------------------------------------------
case "$CMD" in
  wait)          cmd_wait ;;
  dump)          cmd_dump ;;
  reply-inline)  cmd_reply_inline "$@" ;;
  reply-pr)      cmd_reply_pr "$@" ;;
  merge)         cmd_merge ;;
  sync)          cmd_sync ;;
  *)
    echo "Unknown command: $CMD" >&2
    echo "Commands: wait | dump | reply-inline | reply-pr | merge | sync" >&2
    exit 1
    ;;
esac
