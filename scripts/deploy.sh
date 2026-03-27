#!/usr/bin/env bash
# PhotoMind — VPS deploy script
#
# Usage:
#   scripts/deploy.sh              # full deploy
#   scripts/deploy.sh --no-daemon  # skip daemon restart (pipeline running)
#
# Run from any directory; script resolves paths from its own location.

set -euo pipefail

REPO_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
FRONTEND_DIR="$REPO_DIR/frontend"
BACKEND_DIR="$REPO_DIR/backend"
RESTART_DAEMON=true

# ─── Flags ──────────────────────────────────────────────────────────────────

for arg in "$@"; do
  case $arg in
    --no-daemon) RESTART_DAEMON=false ;;
    *) echo "Unknown flag: $arg"; exit 1 ;;
  esac
done

# ─── Helpers ─────────────────────────────────────────────────────────────────

step() { echo ""; echo "▸ $*"; }
ok()   { echo "  ✓ $*"; }
fail() { echo "  ✗ $*"; }

# ─── Deploy ──────────────────────────────────────────────────────────────────

echo "══════════════════════════════════════"
echo " PhotoMind Deploy"
echo " $(date '+%Y-%m-%d %H:%M:%S %Z')"
echo "══════════════════════════════════════"

step "Pulling latest code from origin/main..."
git -C "$REPO_DIR" pull origin main
ok "HEAD: $(git -C "$REPO_DIR" rev-parse --short HEAD)"

step "Installing frontend dependencies..."
cd "$FRONTEND_DIR"
bun install --frozen-lockfile
ok "bun install done"

step "Building Next.js (production)..."
bun run build
ok "Build complete"

step "Running database migrations..."
bun run db:migrate
ok "Migrations applied"

step "Syncing backend Python dependencies..."
cd "$BACKEND_DIR"
uv sync
ok "uv sync done"

step "Restarting services..."
sudo systemctl restart photomind-frontend
ok "photomind-frontend restarted"

sudo systemctl restart photomind-bridge
ok "photomind-bridge restarted"

if [[ "$RESTART_DAEMON" == "true" ]]; then
  sudo systemctl restart photomind-daemon
  ok "photomind-daemon restarted"
else
  echo "  — photomind-daemon skipped (--no-daemon)"
fi

step "Health checks (waiting 5s for services to start)..."
sleep 5

HEALTH_FAIL=0

if curl -sf "http://localhost:3003/api/dashboard" >/dev/null 2>&1; then
  ok "Frontend healthy (port 3003)"
else
  fail "Frontend not responding on port 3003"
  HEALTH_FAIL=1
fi

if curl -sf "http://localhost:8765/health" >/dev/null 2>&1; then
  ok "CLIP bridge healthy (port 8765)"
else
  fail "CLIP bridge not responding — semantic search degraded, text search still works"
fi

echo ""
echo "══════════════════════════════════════"
if [[ $HEALTH_FAIL -eq 0 ]]; then
  echo " Deploy SUCCEEDED"
  echo " Commit: $(git -C "$REPO_DIR" rev-parse --short HEAD)"
else
  echo " Deploy completed with health check FAILURES"
  echo " Check logs: journalctl -u photomind-frontend -n 50"
  exit 1
fi
echo "══════════════════════════════════════"
