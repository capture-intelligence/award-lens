#!/usr/bin/env bash
# =============================================================================
# CaptureRadar — Oracle Always-Free VM bootstrap.
#
# Provisions Postgres 16 + pgvector + pg_trgm + Redis + Node 20 + nginx and
# wires up systemd units for the API and BullMQ worker. All free.
#
# Tested on Oracle Linux 9 (matches the Always-Free ARM Ampere image) and
# Ubuntu 22.04+.
#
# Prereq: clone the repo to /opt/captureradar AS YOUR NORMAL USER first
# (sudo git can't see your SSH deploy key). Then:
#
#   sudo bash /opt/captureradar/apps/api-node/deploy/install.sh
#
# Idempotent — safe to re-run.
# =============================================================================

set -euo pipefail

INSTALL_DIR="/opt/captureradar"
API_DIR="$INSTALL_DIR/apps/api-node"
SERVICE_USER="captureradar"
PG_VERSION="16"
NODE_MAJOR="20"

# Colors
G=$'\033[0;32m'; Y=$'\033[1;33m'; R=$'\033[0;31m'; B=$'\033[0;34m'; X=$'\033[0m'
step() { echo; echo "${B}▸ $*${X}"; }
ok()   { echo "  ${G}✓ $*${X}"; }
warn() { echo "  ${Y}⚠ $*${X}"; }
die()  { echo "${R}✗ $*${X}" >&2; exit 1; }

[[ $EUID -eq 0 ]] || die "Run as root (sudo bash $0)"

# ── Detect distro ──
if   [[ -f /etc/os-release ]] && grep -qiE 'ubuntu|debian' /etc/os-release; then DISTRO="apt"
elif [[ -f /etc/os-release ]] && grep -qiE 'oracle|rhel|fedora|centos|rocky|alma' /etc/os-release; then DISTRO="dnf"
else die "Unsupported distro — need Ubuntu/Debian or Oracle Linux/RHEL family"
fi
ok "Detected package manager: $DISTRO"

# ── Service user ──
step "Ensuring service user '$SERVICE_USER'"
if ! id "$SERVICE_USER" >/dev/null 2>&1; then
  useradd --system --home-dir "$INSTALL_DIR" --shell /bin/bash "$SERVICE_USER"
  ok "user created"
else
  ok "user exists"
fi

# ── Repo present ──
step "Repo at $INSTALL_DIR"
[[ -d "$INSTALL_DIR/.git" ]] || die "$INSTALL_DIR is not a git repo. Clone first: git clone <url> $INSTALL_DIR"
chown -R "$SERVICE_USER:$SERVICE_USER" "$INSTALL_DIR"
ok "repo ready"

# ── Postgres 16 + extensions ──
step "Installing Postgres $PG_VERSION + pg_trgm + pgvector"
if [[ "$DISTRO" == "apt" ]]; then
  install -d /etc/apt/keyrings
  if [[ ! -f /etc/apt/sources.list.d/pgdg.list ]]; then
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc | gpg --dearmor -o /etc/apt/keyrings/pgdg.gpg
    echo "deb [signed-by=/etc/apt/keyrings/pgdg.gpg] https://apt.postgresql.org/pub/repos/apt $(. /etc/os-release; echo $VERSION_CODENAME)-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list
    apt-get update -qq
  fi
  apt-get install -y "postgresql-$PG_VERSION" "postgresql-contrib-$PG_VERSION" "postgresql-${PG_VERSION}-pgvector"
  systemctl enable --now "postgresql"
elif [[ "$DISTRO" == "dnf" ]]; then
  if ! rpm -q pgdg-redhat-repo >/dev/null 2>&1; then
    dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %rhel)-x86_64/pgdg-redhat-repo-latest.noarch.rpm" || \
      dnf install -y "https://download.postgresql.org/pub/repos/yum/reporpms/EL-$(rpm -E %rhel)-aarch64/pgdg-redhat-repo-latest.noarch.rpm"
    dnf -qy module disable postgresql || true
  fi
  dnf install -y "postgresql${PG_VERSION}-server" "postgresql${PG_VERSION}-contrib"
  # pgvector — build from source on Oracle Linux (no official pkg yet for ARM)
  dnf install -y git make gcc redhat-rpm-config "postgresql${PG_VERSION}-devel"
  if [[ ! -d /tmp/pgvector ]]; then
    git clone --depth 1 -b v0.8.0 https://github.com/pgvector/pgvector.git /tmp/pgvector
  fi
  PG_CONFIG="/usr/pgsql-${PG_VERSION}/bin/pg_config" make -C /tmp/pgvector >/dev/null
  PG_CONFIG="/usr/pgsql-${PG_VERSION}/bin/pg_config" make -C /tmp/pgvector install
  if [[ ! -d /var/lib/pgsql/${PG_VERSION}/data/base ]]; then
    "/usr/pgsql-${PG_VERSION}/bin/postgresql-${PG_VERSION}-setup" initdb
  fi
  systemctl enable --now "postgresql-${PG_VERSION}"
fi
ok "postgres up"

# ── DB + role + extensions ──
step "Provisioning database 'captureradar' + role"
DB_PASS_FILE="/etc/captureradar/db.pass"
if [[ ! -f "$DB_PASS_FILE" ]]; then
  install -d -m 750 /etc/captureradar
  openssl rand -hex 24 > "$DB_PASS_FILE"
  chmod 600 "$DB_PASS_FILE"
fi
DB_PASS="$(cat "$DB_PASS_FILE")"

sudo -u postgres psql -tAc "SELECT 1 FROM pg_roles WHERE rolname='captureradar'" | grep -q 1 || \
  sudo -u postgres psql -c "CREATE ROLE captureradar LOGIN PASSWORD '$DB_PASS';"
sudo -u postgres psql -tAc "SELECT 1 FROM pg_database WHERE datname='captureradar'" | grep -q 1 || \
  sudo -u postgres createdb -O captureradar captureradar
sudo -u postgres psql -d captureradar -c "
  CREATE EXTENSION IF NOT EXISTS pg_trgm;
  CREATE EXTENSION IF NOT EXISTS pgcrypto;
  CREATE EXTENSION IF NOT EXISTS vector;
"
ok "db + extensions ready"

# ── Redis ──
step "Installing Redis"
if [[ "$DISTRO" == "apt" ]]; then
  apt-get install -y redis-server
  systemctl enable --now redis-server
else
  dnf install -y redis
  systemctl enable --now redis
fi
# Bind to localhost only (the API runs on the same host).
sed -i 's/^# *bind .*/bind 127.0.0.1/; s/^bind 0\.0\.0\.0/bind 127.0.0.1/' \
  /etc/redis/redis.conf 2>/dev/null \
  || sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis.conf 2>/dev/null || true
systemctl restart redis-server 2>/dev/null || systemctl restart redis
ok "redis up"

# ── Node 20 + pnpm ──
step "Installing Node $NODE_MAJOR and pnpm"
if ! command -v node >/dev/null || [[ "$(node -v 2>/dev/null)" != "v$NODE_MAJOR"* ]]; then
  if [[ "$DISTRO" == "apt" ]]; then
    curl -fsSL "https://deb.nodesource.com/setup_${NODE_MAJOR}.x" | bash -
    apt-get install -y nodejs
  else
    dnf install -y "https://rpm.nodesource.com/pub_${NODE_MAJOR}.x/nodistro/repo/nodesource-release-nodistro-1.noarch.rpm"
    dnf install -y nodejs
  fi
fi
corepack enable
corepack prepare pnpm@9.12.0 --activate
ok "Node $(node -v), pnpm $(pnpm --version)"

# ── nginx ──
step "Installing nginx"
if [[ "$DISTRO" == "apt" ]]; then apt-get install -y nginx; else dnf install -y nginx; fi
install -m 644 "$API_DIR/deploy/nginx.conf" /etc/nginx/conf.d/captureradar.conf
systemctl enable --now nginx
nginx -t && systemctl reload nginx
ok "nginx configured (proxies 80→3000)"

# ── App env file ──
step "Writing /etc/captureradar/api.env"
install -d -m 750 /etc/captureradar
chown root:"$SERVICE_USER" /etc/captureradar
if [[ ! -f /etc/captureradar/api.env ]]; then
  cat > /etc/captureradar/api.env <<EOF
NODE_ENV=production
PORT=3000
LOG_LEVEL=info
DATABASE_URL=postgres://captureradar:${DB_PASS}@127.0.0.1:5432/captureradar
PG_POOL_MAX=10
REDIS_URL=redis://127.0.0.1:6379
SESSION_COOKIE=awards_session
PUBLIC_BASE_URL=https://awards-dashboard.pages.dev
CORS_ORIGINS=https://awards-dashboard.pages.dev
ADMIN_BOOTSTRAP_EMAIL=algocrat@gmail.com
INGESTION_MODE=mixed
WORKERS_AI_DAILY_BUDGET=8000
# Fill in next:
#   CF_ACCOUNT_ID, CF_WORKERS_AI_TOKEN
#   RESEND_API_KEY (alerts), R2_* (document storage)
EOF
  chmod 640 /etc/captureradar/api.env
  chown root:"$SERVICE_USER" /etc/captureradar/api.env
  ok "wrote /etc/captureradar/api.env"
else
  ok "/etc/captureradar/api.env exists — leaving in place"
fi

# ── pnpm install + build ──
step "Installing dependencies and building"
sudo -u "$SERVICE_USER" bash -lc "cd $INSTALL_DIR && pnpm install --frozen-lockfile"
sudo -u "$SERVICE_USER" bash -lc "cd $API_DIR && pnpm build"
sudo -u "$SERVICE_USER" bash -lc "cd $API_DIR && pnpm db:generate && pnpm db:migrate"
ok "build + migrate complete"

# ── systemd units ──
step "Installing systemd units"
install -m 644 "$API_DIR/deploy/captureradar-api.service"     /etc/systemd/system/
install -m 644 "$API_DIR/deploy/captureradar-worker.service"  /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now captureradar-api captureradar-worker
ok "systemd units up — api on :3000, worker running"

# ── firewall ──
step "Opening port 80 (nginx)"
if command -v firewall-cmd >/dev/null; then
  firewall-cmd --permanent --add-service=http
  firewall-cmd --reload
elif command -v ufw >/dev/null; then
  ufw allow 80/tcp || true
fi

echo
echo "${G}✓ CaptureRadar API + worker provisioned${X}"
echo
echo "  Verify:"
echo "    curl http://127.0.0.1:3000/health"
echo "    curl http://127.0.0.1:3000/health/ready"
echo "    journalctl -u captureradar-api -f"
echo
echo "  DB password is at /etc/captureradar/db.pass (root:${SERVICE_USER}, 0640)."
echo "  Edit /etc/captureradar/api.env then: systemctl restart captureradar-api captureradar-worker"
