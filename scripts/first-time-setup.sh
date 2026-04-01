#!/usr/bin/env bash
# PhotoMind — First-Time VPS Setup
# Run as: sudo bash scripts/first-time-setup.sh
# Idempotent: safe to re-run.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
TAILSCALE_HOST="vps.tailafcd2f.ts.net"
DATA_DIR="/home/karthik/photomind"
BUN_BIN="/home/karthik/.bun/bin/bun"
# PhotoMind external HTTPS port (443 + 8443 already used by other apps on this VPS)
PHOTOMIND_HTTPS_PORT=4000
# Internal Next.js port
PHOTOMIND_INTERNAL_PORT=3003

BOLD="\033[1m"
GREEN="\033[32m"
YELLOW="\033[33m"
RED="\033[31m"
RESET="\033[0m"

step()  { echo -e "\n${BOLD}▶ $*${RESET}"; }
ok()    { echo -e "  ${GREEN}✓ $*${RESET}"; }
warn()  { echo -e "  ${YELLOW}⚠ $*${RESET}"; }
die()   { echo -e "  ${RED}✗ $*${RESET}"; exit 1; }

# ── Must run as root ───────────────────────────────────────────────────────────
[[ $EUID -eq 0 ]] || die "Run with sudo: sudo bash scripts/first-time-setup.sh"

# ── 1. Disable nginx (this VPS uses tailscale serve for TLS — nginx not needed) ─
step "nginx (disable)"
if command -v nginx &>/dev/null; then
    systemctl disable --now nginx 2>/dev/null || true
    ok "nginx disabled (tailscale serve handles TLS on this VPS)"
else
    ok "nginx not installed — nothing to do"
fi

# Clean up any stray cert files left in the repo root from earlier attempts
rm -f "$REPO_ROOT"/vps.tailafcd2f.ts.net.crt \
      "$REPO_ROOT"/vps.tailafcd2f.ts.net.key

# ── 2. tailscale serve — expose PhotoMind on HTTPS port 4000 ──────────────────
step "tailscale serve (HTTPS :${PHOTOMIND_HTTPS_PORT})"
# Run as karthik (tailscale serve is per-user)
if sudo -u karthik tailscale serve status 2>/dev/null | grep -q ":${PHOTOMIND_HTTPS_PORT}"; then
    ok "tailscale serve :${PHOTOMIND_HTTPS_PORT} already configured"
else
    sudo -u karthik tailscale serve \
        --https="${PHOTOMIND_HTTPS_PORT}" \
        --bg \
        --yes \
        "${PHOTOMIND_INTERNAL_PORT}" \
        || die "tailscale serve failed — is tailscale running?"
    ok "Configured: https://${TAILSCALE_HOST}:${PHOTOMIND_HTTPS_PORT} → localhost:${PHOTOMIND_INTERNAL_PORT}"
fi

# ── 4. bun symlink ─────────────────────────────────────────────────────────────
step "bun in PATH for systemd"
if [[ -x "$BUN_BIN" ]]; then
    ln -sf "$BUN_BIN" /usr/local/bin/bun
    # bunx is a symlink to bun in the bun install dir
    ln -sf "$BUN_BIN" /usr/local/bin/bunx
    ok "Symlinked bun + bunx → /usr/local/bin/"
else
    die "bun not found at $BUN_BIN — is Bun installed for user karthik?"
fi

# ── 5. systemd service files ──────────────────────────────────────────────────
step "systemd services"
for svc in photomind-frontend photomind-daemon photomind-bridge; do
    cp "$REPO_ROOT/deploy/${svc}.service" "/etc/systemd/system/${svc}.service"
    ok "Installed ${svc}.service"
done

systemctl daemon-reload
ok "daemon-reload done"

for svc in photomind-frontend photomind-daemon photomind-bridge; do
    systemctl enable "$svc"
    ok "Enabled $svc"
done

# ── 6. Runtime directories ─────────────────────────────────────────────────────
step "Runtime directories"
sudo -u karthik mkdir -p \
    "$DATA_DIR/thumbnails" \
    "$DATA_DIR/chroma_db" \
    "$DATA_DIR/tmp"
ok "Created $DATA_DIR/{thumbnails,chroma_db,tmp}"

# ── 7. .env.production ─────────────────────────────────────────────────────────
step ".env.production"
ENV_FILE="$DATA_DIR/.env.production"
if [[ -f "$ENV_FILE" ]]; then
    ok "$ENV_FILE already exists — not overwriting"
else
    cp "$REPO_ROOT/deploy/env.production.template" "$ENV_FILE"
    chown karthik:karthik "$ENV_FILE"
    chmod 600 "$ENV_FILE"
    ok "Created $ENV_FILE from template"
fi

# ── 8. Initial deploy (build + migrate + start all services) ──────────────────
step "Running deploy.sh (build → migrate → start services)"
# deploy.sh calls `sudo systemctl restart` internally — must run as karthik
# but with sudo access already granted via this script's root context
sudo -u karthik bash "$REPO_ROOT/scripts/deploy.sh" \
  || { warn "deploy.sh reported a failure — check logs above"; }

# ── 9. Smoke test ─────────────────────────────────────────────────────────────
step "Smoke test"
SMOKE="$REPO_ROOT/scripts/smoke-test.sh"
if [[ -x "$SMOKE" ]]; then
    sudo -u karthik bash "$SMOKE" "https://${TAILSCALE_HOST}:${PHOTOMIND_HTTPS_PORT}" \
      || warn "Smoke test had failures — check service logs"
else
    warn "smoke-test.sh not found — skipping"
fi

# ── 10. Summary ────────────────────────────────────────────────────────────────
echo ""
echo -e "${BOLD}╔══════════════════════════════════════════════════╗${RESET}"
echo -e "${BOLD}║            First-time setup COMPLETE             ║${RESET}"
echo -e "${BOLD}╚══════════════════════════════════════════════════╝${RESET}"
echo ""
echo -e "  ${GREEN}Access URL: https://$TAILSCALE_HOST:$PHOTOMIND_HTTPS_PORT${RESET}"
echo ""
echo -e "  ${YELLOW}If the daemon is not running, create config.yaml first:${RESET}"
echo -e "     nano $DATA_DIR/config.yaml"
echo -e "     sudo systemctl restart photomind-daemon"
echo ""
echo -e "  Logs:"
echo -e "     journalctl -u photomind-frontend -f"
echo -e "     journalctl -u photomind-daemon   -f"
echo -e "     journalctl -u photomind-bridge   -f"
echo ""
