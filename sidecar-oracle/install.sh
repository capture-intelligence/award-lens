#!/usr/bin/env bash
# =============================================================================
# Awards Pipeline sidecar — VM bootstrap (Oracle Cloud Always-Free or any
# Ubuntu 22.04+ / Oracle Linux 9+ host).
#
# Prereq: clone the repo to /opt/awards-pipeline AS YOUR NORMAL USER first.
# This script does NOT clone (sudo git can't see your SSH deploy key), it just
# bootstraps Node, the service user, .env, and systemd.
#
# Typical flow on a fresh VM (see sidecar-oracle/README.md for full walkthrough):
#
#   sudo apt-get update && sudo apt-get install -y git
#   ssh-keygen -t ed25519 -f ~/.ssh/github-awards -N "" -C "vm-name"
#   # Add the .pub via:  gh repo deploy-key add ~/.ssh/github-awards.pub --repo OWNER/REPO
#   cat >> ~/.ssh/config <<'EOF'
#   Host github.com
#     IdentityFile ~/.ssh/github-awards
#     IdentitiesOnly yes
#     StrictHostKeyChecking accept-new
#   EOF
#   chmod 600 ~/.ssh/config
#   git clone git@github.com:OWNER/REPO.git /tmp/awards
#   sudo mkdir -p /opt && sudo mv /tmp/awards /opt/awards-pipeline
#   bash /opt/awards-pipeline/sidecar-oracle/install.sh
#
# Run this as your sudo-capable user, NOT as root.
# =============================================================================

set -euo pipefail

INSTALL_DIR="/opt/awards-pipeline"
SIDECAR_DIR="$INSTALL_DIR/sidecar-oracle"
SERVICE_USER="awards"

# ── colors ──
G=$'\033[0;32m'; Y=$'\033[1;33m'; R=$'\033[0;31m'; B=$'\033[0;34m'; X=$'\033[0m'
step() { echo; echo "${B}▸ $*${X}"; }
ok()   { echo "  ${G}✓ $*${X}"; }
warn() { echo "  ${Y}⚠ $*${X}"; }
die()  { echo "${R}✗ $*${X}" >&2; exit 1; }

[[ $EUID -eq 0 ]] && die "Do not run this script as root. Run as your normal sudo-capable user."
command -v sudo >/dev/null || die "sudo is required"

# ── 1. Node.js ──
step "Installing Node.js 20"
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null)" != v20* && "$(node -v 2>/dev/null)" != v21* && "$(node -v 2>/dev/null)" != v22* ]]; then
  if command -v apt-get >/dev/null; then
    curl -fsSL https://deb.nodesource.com/setup_20.x | sudo -E bash -
    sudo apt-get install -y nodejs git
  elif command -v dnf >/dev/null; then
    sudo dnf install -y https://rpm.nodesource.com/pub_20.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm
    sudo dnf install -y nodejs git
  else
    die "Unsupported distro — install Node.js 20 manually first."
  fi
fi
ok "Node $(node -v), npm $(npm -v)"

# ── 2. Service user ──
step "Creating service user '$SERVICE_USER'"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  sudo useradd --system --home-dir "$INSTALL_DIR" --shell /usr/sbin/nologin "$SERVICE_USER"
  ok "user created"
else
  ok "user exists"
fi

# ── 3. Repo ──
# We deliberately do NOT clone or pull from inside this script — it would have
# to run `sudo git ...` which then can't see the user's SSH deploy key or PAT.
# Instead, you (the operator) clone the repo as your normal user before running
# this script (see README step 3). This script only:
#   - verifies the repo is present
#   - chowns it to the service user
#   - tries an optional best-effort `git pull` as the original cloner so
#     re-running install.sh on a previously installed VM picks up updates.
step "Repo at $INSTALL_DIR"
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  die "$INSTALL_DIR is not a git repo. Clone first:
    git clone git@github.com:<owner>/<repo>.git $INSTALL_DIR
  (See sidecar-oracle/README.md step 3 for the deploy-key flow.)"
fi

# Best-effort pull as whichever user originally owns the repo dir (they have
# the SSH config for github.com). Skip silently if it fails — the operator
# can `git pull` manually before re-running.
ORIG_OWNER="$(stat -c '%U' "$INSTALL_DIR")"
if [[ "$ORIG_OWNER" != "$SERVICE_USER" && "$ORIG_OWNER" != "root" ]]; then
  if sudo -u "$ORIG_OWNER" git -C "$INSTALL_DIR" pull --ff-only --quiet 2>/dev/null; then
    ok "repo synced (pulled as $ORIG_OWNER)"
  else
    warn "git pull failed or no upstream changes — continuing with current checkout"
  fi
else
  note "skipping git pull (repo is owned by $ORIG_OWNER, no SSH config available)"
fi

sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
ok "repo ready (owned by $SERVICE_USER)"

# ── 4. .env ──
step "Environment file"
if [[ ! -f "$SIDECAR_DIR/.env" ]]; then
  sudo -u "$SERVICE_USER" cp "$SIDECAR_DIR/env.example" "$SIDECAR_DIR/.env"
  sudo chmod 600 "$SIDECAR_DIR/.env"
  warn "Edit $SIDECAR_DIR/.env before the first timer fires:"
  warn "  sudo -u $SERVICE_USER nano $SIDECAR_DIR/.env"
else
  ok ".env already exists — leaving untouched"
fi

# ── 5. systemd ──
step "Installing systemd units"
sudo cp "$SIDECAR_DIR/systemd/awards-sidecar.service" /etc/systemd/system/
sudo cp "$SIDECAR_DIR/systemd/awards-sidecar.timer" /etc/systemd/system/
sudo systemctl daemon-reload
sudo systemctl enable --now awards-sidecar.timer
ok "timer enabled"

# ── 6. Summary ──
echo
echo "${G}════════════════════════════════════════════════════════${X}"
echo "${G}  Sidecar installed${X}"
echo "${G}════════════════════════════════════════════════════════${X}"
echo
echo "  Next steps:"
echo "    1. Edit config:   sudo -u $SERVICE_USER nano $SIDECAR_DIR/.env"
echo "    2. Test run now:  sudo systemctl start awards-sidecar.service"
echo "    3. Watch logs:    sudo journalctl -u awards-sidecar -f"
echo "    4. Check timer:   sudo systemctl list-timers awards-sidecar.timer"
echo
