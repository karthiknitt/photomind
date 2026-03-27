#!/usr/bin/env bash
# PhotoMind — Smoke test
#
# Usage:
#   scripts/smoke-test.sh                          # test localhost:3003
#   scripts/smoke-test.sh https://100.106.254.102  # test via Tailscale IP
#   scripts/smoke-test.sh https://your.ts.net      # test via Tailscale hostname

set -euo pipefail

BASE_URL="${1:-http://localhost:3003}"
PASS=0
FAIL=0

# ─── Helpers ─────────────────────────────────────────────────────────────────

check() {
  local name="$1"
  local url="$2"
  local expected_status="${3:-200}"
  local actual_status
  actual_status=$(curl -sk -o /dev/null -w "%{http_code}" \
    --max-time 10 "$url" 2>/dev/null || echo "000")
  if [[ "$actual_status" == "$expected_status" ]]; then
    echo "  ✓ [$actual_status] $name"
    ((PASS++)) || true
  else
    echo "  ✗ [$actual_status] $name  (expected $expected_status)"
    ((FAIL++)) || true
  fi
}

check_json() {
  local name="$1"
  local url="$2"
  local jq_filter="$3"
  local response
  response=$(curl -sk --max-time 10 "$url" 2>/dev/null || echo "{}")
  if echo "$response" | jq -e "$jq_filter" >/dev/null 2>&1; then
    echo "  ✓ [json] $name"
    ((PASS++)) || true
  else
    echo "  ✗ [json] $name  (filter '$jq_filter' failed)"
    echo "           response: ${response:0:100}"
    ((FAIL++)) || true
  fi
}

# ─── Run tests ───────────────────────────────────────────────────────────────

echo "══════════════════════════════════════"
echo " PhotoMind Smoke Test"
echo " $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo " Base URL: $BASE_URL"
echo "══════════════════════════════════════"

echo ""
echo "── Pages ────────────────────────────"
check "Gallery"   "$BASE_URL/"
check "Search"    "$BASE_URL/search"
check "Faces"     "$BASE_URL/faces"
check "Dashboard" "$BASE_URL/dashboard"
check "Logs"      "$BASE_URL/logs"
check "Settings"  "$BASE_URL/settings"

echo ""
echo "── API Routes ───────────────────────"
check "GET /api/photos"          "$BASE_URL/api/photos"
check "GET /api/dashboard"       "$BASE_URL/api/dashboard"
check "GET /api/faces/clusters"  "$BASE_URL/api/faces/clusters"
check "GET /api/logs"            "$BASE_URL/api/logs"
check "GET /api/search?q=test"   "$BASE_URL/api/search?q=test"
check "GET /api/settings"        "$BASE_URL/api/settings"
check "GET /api/settings/health" "$BASE_URL/api/settings/health"

echo ""
echo "── API Response Shape ───────────────"
check_json "photos has pagination"   "$BASE_URL/api/photos"          '.pagination.total >= 0'
check_json "dashboard has stats"     "$BASE_URL/api/dashboard"       '.stats.total >= 0'
check_json "clusters is array"       "$BASE_URL/api/faces/clusters"  '.clusters | type == "array"'
check_json "logs has pagination"     "$BASE_URL/api/logs"            '.pagination.total >= 0'
check_json "settings has system"     "$BASE_URL/api/settings"        '.system.databasePath | type == "string"'

echo ""
echo "── Bridge health ────────────────────"
check "CLIP bridge (internal)" "http://localhost:8765/health"

echo ""
echo "══════════════════════════════════════"
if [[ $FAIL -eq 0 ]]; then
  echo " ALL $PASS CHECKS PASSED"
  echo "══════════════════════════════════════"
  exit 0
else
  echo " $PASS passed, $FAIL FAILED"
  echo " Check logs: journalctl -u photomind-frontend -n 100"
  echo "══════════════════════════════════════"
  exit 1
fi
