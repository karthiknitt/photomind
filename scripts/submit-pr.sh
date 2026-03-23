#!/usr/bin/env bash
# submit-pr.sh — create a PR and assign coderabbitai[bot] as reviewer
#
# Usage: scripts/submit-pr.sh <branch> "<title>" [base_branch]
#
# Examples:
#   scripts/submit-pr.sh feat/exif-service "feat(exif): add EXIF extraction service"
#   scripts/submit-pr.sh fix/thumbnail "fix(thumbnail): handle RGBA images" main
#
# Requirements: gh CLI authenticated as karthiknitt

set -euo pipefail

BRANCH="${1:?Usage: $0 <branch> <title> [base_branch]}"
TITLE="${2:?Usage: $0 <branch> <title> [base_branch]}"
BASE="${3:-main}"

REPO="karthiknitt/photomind"

echo "==> Creating PR: '$TITLE' ($BRANCH → $BASE)"

PR_URL=$(gh pr create \
  --repo "$REPO" \
  --head "$BRANCH" \
  --base "$BASE" \
  --title "$TITLE" \
  --body "$(cat <<'EOF'
## Summary

<!-- Added by Claude Code -->

## Test plan

- [ ] All tests passing (`uv run pytest`)
- [ ] Coverage ≥ 80%
- [ ] Ruff passes (`uv run ruff check src/`)

🤖 Generated with [Claude Code](https://claude.ai/claude-code)
EOF
)")

PR_NUMBER=$(echo "$PR_URL" | grep -oP '(?<=/pull/)\d+')

echo "==> PR created: $PR_URL"
echo "==> Assigning coderabbitai[bot] as reviewer..."

gh api "repos/$REPO/pulls/$PR_NUMBER/requested_reviewers" \
  --method POST \
  -f "reviewers[]=coderabbitai" 2>/dev/null || \
  echo "    (note: coderabbitai may auto-assign itself — manual assignment optional)"

echo ""
echo "==> Done. PR #$PR_NUMBER is open."
echo "    Wait ~2 min for CodeRabbit to review, then run:"
echo "    scripts/review-pr.sh $PR_NUMBER"
