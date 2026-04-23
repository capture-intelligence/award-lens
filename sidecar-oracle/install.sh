#!/usr/bin/env bash
# =============================================================================
# One-shot bootstrap for the Awards Pipeline sidecar on Oracle Cloud Always-Free
# (Ubuntu 22.04+ or Oracle Linux 9+ on Arm A1.Flex or AMD E2.1.Micro).
#
# What it does:
#   1. Installs Node.js 20 (from NodeSource)
#   2. Creates a dedicated `awards` system user
#   3. Clones the repo to /opt/awards-pipeline
#   4. Copies env.example → .env (you edit it once)
#   5. Installs + enables the systemd service + timer
#
# Run as your sudo-capable user (NOT root):
#   curl -fsSL https://raw.githubusercontent.com/<you>/<repo>/main/sidecar-oracle/install.sh | bash
# or, after cloning manually:
#   bash /opt/awards-pipeline/sidecar-oracle/install.sh
# =============================================================================

set -euo pipefail

REPO_URL="${REPO_URL:-https://github.com/REPLACE_ME/past-awards-dashboard.git}"
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
step "Syncing repo at $INSTALL_DIR"
sudo mkdir -p "$INSTALL_DIR"
if [[ ! -d "$INSTALL_DIR/.git" ]]; then
  sudo git clone "$REPO_URL" "$INSTALL_DIR"
else
  sudo git -C "$INSTALL_DIR" pull --ff-only
fi
sudo chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
ok "repo ready"

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
