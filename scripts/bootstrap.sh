#!/usr/bin/env bash
# =============================================================================
# Awards pipeline — one-shot bootstrap.
#
# Creates every Cloudflare resource, replaces wrangler.toml placeholders,
# applies D1 migrations, deploys all workers in dependency order, uploads
# the SAM API secret, deploys the Pages dashboard, and kicks off the
# initial toptier backfill + USAspending incremental.
#
# Safe to re-run. State is cached in .bootstrap-state at the repo root.
#
# Prereqs:
#   • node 20+
#   • pnpm installed (`npm i -g pnpm`)
#   • `npx wrangler login` already run
#   • workers/sam-api/.dev.vars populated with SAM_GOV_API_KEY=...
# =============================================================================

set -euo pipefail

# Resolve repo root regardless of where the script is called from
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"
cd "$ROOT"

STATE_FILE="$ROOT/.bootstrap-state"
SAM_DEV_VARS="$ROOT/workers/sam-api/.dev.vars"
WRANGLER="npx --yes wrangler"

# Colors (disable if not a TTY)
if [[ -t 1 ]]; then
  B=$'\033[0;34m'; G=$'\033[0;32m'; Y=$'\033[1;33m'
  R=$'\033[0;31m'; D=$'\033[0;37m'; X=$'\033[0m'
else
  B=''; G=''; Y=''; R=''; D=''; X=''
fi

step() { echo; echo "${B}▸ $*${X}"; }
ok()   { echo "  ${G}✓ $*${X}"; }
warn() { echo "  ${Y}⚠ $*${X}"; }
note() { echo "  ${D}$*${X}"; }
die()  { echo "${R}✗ $*${X}" >&2; exit 1; }

# -----------------------------------------------------------------------------
# Preflight
# -----------------------------------------------------------------------------
step "Preflight"
command -v node >/dev/null || die "node not found"
command -v pnpm >/dev/null || die "pnpm not found — run: npm i -g pnpm"
$WRANGLER whoami >/dev/null 2>&1 || die "not logged in — run: npx wrangler login"
ok "wrangler authenticated"

# -----------------------------------------------------------------------------
# Load prior state if any
# -----------------------------------------------------------------------------
D1_ID=""; KV_ID=""
[[ -f "$STATE_FILE" ]] && source "$STATE_FILE"

# -----------------------------------------------------------------------------
# Install deps
# -----------------------------------------------------------------------------
step "Installing dependencies"
pnpm install --silent
ok "deps installed"

# -----------------------------------------------------------------------------
# Helpers
# -----------------------------------------------------------------------------
# Parse JSON with node (no external jq dependency)
json_find() {
  # usage: echo "$json" | json_find '<JS expression returning a string>'
  node -e "let s='';process.stdin.on('data',c=>s+=c).on('end',()=>{try{const d=JSON.parse(s);const v=($1);if(v)console.log(v);}catch(e){}});"
}

ensure_d1() {
  local name="$1"
  local existing
  existing=$($WRANGLER d1 list --json 2>/dev/null \
    | json_find "(d.find(x=>x.name==='$name')||{}).uuid" || true)
  if [[ -n "${existing:-}" ]]; then
    echo "$existing"; return
  fi
  local out
  out=$($WRANGLER d1 create "$name" 2>&1)
  echo "$out" | grep -oE 'database_id = "[a-f0-9-]+"' | head -1 \
    | sed -E 's/.*"([^"]+)".*/\1/' \
    || { echo "$out" >&2; die "could not parse D1 id"; }
}

ensure_kv() {
  local binding="$1"
  local existing
  existing=$($WRANGLER kv namespace list 2>/dev/null \
    | json_find "(d.find(x=>x.title.endsWith('-$binding')||x.title==='$binding')||{}).id" || true)
  if [[ -n "${existing:-}" ]]; then
    echo "$existing"; return
  fi
  local out
  out=$($WRANGLER kv namespace create "$binding" 2>&1)
  echo "$out" | grep -oE 'id = "[a-f0-9]+"' | head -1 \
    | sed -E 's/.*"([^"]+)".*/\1/' \
    || { echo "$out" >&2; die "could not parse KV id"; }
}

ensure_r2() {
  local name="$1"
  local out
  if out=$($WRANGLER r2 bucket create "$name" 2>&1); then
    ok "R2 bucket created: $name"
  elif echo "$out" | grep -q -E 'already exists|AlreadyOwnedByYou|BucketAlreadyExists'; then
    note "R2 bucket exists: $name"
  else
    echo "$out" >&2; die "r2 bucket create failed"
  fi
}

ensure_queue() {
  local name="$1"
  local out
  if out=$($WRANGLER queues create "$name" 2>&1); then
    ok "queue created: $name"
  elif echo "$out" | grep -q -i 'already exists'; then
    note "queue exists: $name"
  else
    echo "$out" >&2; die "queue create failed: $name"
  fi
}

# -----------------------------------------------------------------------------
# Create resources
# -----------------------------------------------------------------------------
step "D1 database"
if [[ -z "$D1_ID" ]]; then
  D1_ID=$(ensure_d1 awards-warehouse)
fi
ok "D1: $D1_ID"

step "KV namespace"
if [[ -z "$KV_ID" ]]; then
  KV_ID=$(ensure_kv META)
fi
ok "KV: $KV_ID"

step "R2 buckets"
ensure_r2 awards-staging

step "Queues"
ensure_queue normalize-queue
ensure_queue upsert-queue
ensure_queue sam-enrich-queue
ensure_queue dlq

# -----------------------------------------------------------------------------
# Persist state
# -----------------------------------------------------------------------------
cat > "$STATE_FILE" <<EOF
# Auto-generated by scripts/bootstrap.sh — DO NOT COMMIT
D1_ID="$D1_ID"
KV_ID="$KV_ID"
EOF
ok "state saved → $STATE_FILE"

# -----------------------------------------------------------------------------
# Inject IDs into wrangler.toml files
# -----------------------------------------------------------------------------
step "Wiring IDs into wrangler.toml files"
TOMLS=(
  workers/api/wrangler.toml
  workers/scheduler/wrangler.toml
  workers/usaspending-workflow/wrangler.toml
  workers/sam-bulk-workflow/wrangler.toml
  workers/grants-gov-workflow/wrangler.toml
  workers/sam-api/wrangler.toml
  workers/normalizer/wrangler.toml
  workers/upsert/wrangler.toml
)
for f in "${TOMLS[@]}"; do
  [[ -f "$f" ]] || continue
  if grep -qE 'REPLACE_WITH_YOUR_(D1|KV)_ID' "$f"; then
    sed -i.bak \
      -e "s|REPLACE_WITH_YOUR_D1_ID|$D1_ID|g" \
      -e "s|REPLACE_WITH_YOUR_KV_ID|$KV_ID|g" \
      "$f"
    rm -f "$f.bak"
    ok "$f"
  else
    note "$f (already wired)"
  fi
done

# -----------------------------------------------------------------------------
# Apply D1 migrations
# -----------------------------------------------------------------------------
step "Applying D1 migrations (remote)"
( cd workers/api && $WRANGLER d1 migrations apply awards-warehouse --remote ) \
  || warn "migrations returned non-zero (often means already up to date)"

# -----------------------------------------------------------------------------
# Deploy workers — DEPENDENCY ORDER MATTERS
#   1) sam-api-worker first (api-worker has a service binding to it)
#   2) upload SAM_GOV_API_KEY secret
#   3) everything else
# -----------------------------------------------------------------------------
step "Deploying sam-api-worker (dependency root)"
( cd workers/sam-api && $WRANGLER deploy )
ok "sam-api-worker deployed"

step "Uploading SAM_GOV_API_KEY secret"
if [[ -f "$SAM_DEV_VARS" ]]; then
  SAM_KEY=$(grep -E '^SAM_GOV_API_KEY=' "$SAM_DEV_VARS" | head -1 | cut -d= -f2-)
  if [[ -n "$SAM_KEY" ]]; then
    ( cd workers/sam-api && echo "$SAM_KEY" | $WRANGLER secret put SAM_GOV_API_KEY )
    ok "secret uploaded"
  else
    warn "no SAM_GOV_API_KEY= line in $SAM_DEV_VARS — skipping"
  fi
else
  warn "$SAM_DEV_VARS missing — secret not uploaded"
fi

for w in usaspending-workflow sam-bulk-workflow grants-gov-workflow \
         normalizer upsert scheduler api; do
  step "Deploying $w"
  ( cd "workers/$w" && $WRANGLER deploy )
  ok "$w deployed"
done

# -----------------------------------------------------------------------------
# Deploy the Pages dashboard
# -----------------------------------------------------------------------------
step "Deploying web dashboard (Cloudflare Pages)"
( cd web && pnpm install --silent && pnpm deploy ) || warn "pages deploy failed — see above"

# -----------------------------------------------------------------------------
# Kickoff: toptier backfill + first USAspending incremental + first SAM bulk
# -----------------------------------------------------------------------------
step "First-run kickoffs"

# Resolve the scheduler URL. Accounts differ on subdomain — prefer env var, fall
# back to user's default workers.dev subdomain. If unresolved, print manual
# commands instead of guessing.
ACCOUNT_SUB="${CF_WORKERS_SUBDOMAIN:-}"
if [[ -z "$ACCOUNT_SUB" ]]; then
  note "set CF_WORKERS_SUBDOMAIN=<your-subdomain> to auto-trigger"
  SCHED_URL=""
else
  SCHED_URL="https://scheduler-worker.${ACCOUNT_SUB}.workers.dev"
fi

if [[ -n "$SCHED_URL" ]]; then
  echo "  POST $SCHED_URL/trigger/backfill-toptier-codes"
  curl -sS -X POST "$SCHED_URL/trigger/backfill-toptier-codes" | head -c 500; echo

  echo "  POST $SCHED_URL/trigger/usaspending  (incremental)"
  curl -sS -X POST "$SCHED_URL/trigger/usaspending" \
    -H 'content-type: application/json' -d '{"mode":"incremental"}' | head -c 300; echo

  echo "  POST $SCHED_URL/trigger/sam-bulk"
  curl -sS -X POST "$SCHED_URL/trigger/sam-bulk" \
    -H 'content-type: application/json' -d '{"extracts":["exclusions"]}' | head -c 300; echo
  ok "triggers fired"
else
  cat <<MANUAL

  Run these manually once you know your workers.dev subdomain:

    curl -X POST https://scheduler-worker.<sub>.workers.dev/trigger/backfill-toptier-codes
    curl -X POST https://scheduler-worker.<sub>.workers.dev/trigger/usaspending \\
      -H 'content-type: application/json' -d '{"mode":"incremental"}'
    curl -X POST https://scheduler-worker.<sub>.workers.dev/trigger/sam-bulk \\
      -H 'content-type: application/json' -d '{"extracts":["exclusions"]}'

MANUAL
fi

# -----------------------------------------------------------------------------
# Done
# -----------------------------------------------------------------------------
echo
echo "${G}════════════════════════════════════════════════════════${X}"
echo "${G}  Bootstrap complete${X}"
echo "${G}════════════════════════════════════════════════════════${X}"
echo
echo "  Resource IDs cached in: $STATE_FILE"
echo
echo "  Next checks (substitute your workers.dev subdomain):"
echo "    • Overview:     GET  /stats/overview"
echo "    • Schedule:     GET  /schedule/status"
echo "    • SAM budget:   GET  /sam-api/status"
echo
echo "  Tail logs:"
echo "    npx wrangler tail usaspending-workflow"
echo "    npx wrangler tail sam-api-worker"
echo
