# CaptureRadar — Phase 0 Deployment Runbook

This runbook walks through standing up CaptureRadar's new infrastructure on the **Oracle Always-Free VM + Cloudflare Pages free tier** at **$0/mo**. Phase 0 covers the foundation; Phase 1 ingestion and pages are documented separately.

## What you're deploying

```
                     Cloudflare (free tier)
              ┌──────────────────────────────────┐
              │ Pages: dashboard SPA              │
              │   + functions/_middleware (proxy) │
              │ Workers:                           │
              │   - api (OAuth issuance only)     │
              │   - sam-api (vendor enrichment)   │
              │ R2: documents bucket              │
              └────────────┬─────────────────────┘
                           │   first-party cookies via Pages proxy
                           ▼
         Oracle Always-Free VM (4 ARM cores / 24GB / 200GB)
              ┌──────────────────────────────────┐
              │ Postgres 16 + pg_trgm + pgvector │
              │ Redis 7                           │
              │ captureradar-api.service  :3000   │
              │ captureradar-worker.service       │
              │ nginx                      :80    │
              └──────────────────────────────────┘
```

**Costs:** $0/mo capped. Postgres on the VM disk (200GB headroom), Redis on the VM, API + workers on the VM, frontend on Pages free, documents in R2 free 10GB, AI inference on Workers AI free 10K/day, email alerts on Resend free 3K/mo.

## Prerequisites

- Existing **Oracle Cloud Always-Free VM** (Ubuntu 22.04+ or Oracle Linux 9). The same VM the legacy `sidecar-oracle` runs on is fine — we share it.
- **Cloudflare account** with the Pages project (`awards-dashboard`) and the two Workers (`api-worker`, `sam-api-worker`) already provisioned. These were created during AwardLens setup — keep them.
- **Domain** (optional). The deployment URL stays at `awards-dashboard.pages.dev` until you buy one. The brand is CaptureRadar regardless.

## 1. Clone the repo on the VM

```bash
ssh ubuntu@<your-vm>
sudo mkdir -p /opt
cd /opt
sudo chown $USER:$USER /opt
git clone git@github.com:<owner>/past-awards-dashboard.git captureradar
cd captureradar
```

If the VM was already running the legacy AwardLens sidecar, it's at `/opt/awards-pipeline`. Either:
- **Adopt** the new repo: `git remote set-url origin git@github.com:.../past-awards-dashboard.git && git pull` and rename the directory to `/opt/captureradar`, **or**
- **Side-by-side**: clone the new repo to `/opt/captureradar` and let both run. The legacy systemd timers and the new `captureradar-api` service won't collide.

## 2. Run the bootstrap script

```bash
sudo bash /opt/captureradar/apps/api-node/deploy/install.sh
```

This installs:
- Postgres 16 + `pg_trgm` + `pgcrypto` + `pgvector` (built from source on Oracle Linux ARM)
- Redis 7 bound to localhost
- Node 20 + pnpm 9
- nginx with the CaptureRadar reverse-proxy config
- The `captureradar` service user
- A random Postgres password at `/etc/captureradar/db.pass`
- `/etc/captureradar/api.env` pre-populated with sane defaults
- `captureradar-api.service` and `captureradar-worker.service` systemd units
- `firewall-cmd`/`ufw` opens port 80

The script is **idempotent** — re-run it after pulling new code to upgrade.

## 3. Cloudflare Workers AI token

Workers AI gives us 10K free neurons/day. Generate a token:

1. https://dash.cloudflare.com/profile/api-tokens → **Create Token** → **Custom token**
2. Permissions: **Account → Workers AI → Read & Write**
3. Paste into `/etc/captureradar/api.env`:

```bash
sudo -e /etc/captureradar/api.env
# Set:
#   CF_ACCOUNT_ID=<your account id>
#   CF_WORKERS_AI_TOKEN=<the token>
sudo systemctl restart captureradar-api captureradar-worker
```

**Cost:** $0 up to 10K calls/day (covers all batch AI summaries for a 80K-row demo dataset over a week, plus your investor demo's chat usage).

## 4. Resend (email alerts)

Saved-search alerts deliver via Resend — 100/day free, 3K/mo on the free tier.

1. https://resend.com → sign up
2. **API Keys** → create one
3. Add to `/etc/captureradar/api.env`:

```
RESEND_API_KEY=re_...
ALERT_FROM_EMAIL=alerts@<your-domain>   # or alerts@captureradar.app
```

If you don't have a verified domain yet, leave `ALERT_FROM_EMAIL` set to a Resend-allowed address. Re-deploy isn't required; alert dispatch is fed via BullMQ.

## 5. Verify the API

```bash
# On the VM
curl http://127.0.0.1:3000/health
# → {"ok":true,"service":"captureradar-api","ts":"…"}

curl http://127.0.0.1:3000/health/ready
# → {"ok":true,"checks":{"postgres":{"ok":true,…},"redis":{"ok":true,…}}}

# From your laptop (assumes Cloudflare DNS is pointing at the VM)
curl https://api.captureradar.app/health
```

If `/health` works but `/health/ready` doesn't, check `journalctl -u captureradar-api -n 50` — most often a Postgres password mismatch in `api.env`.

## 6. Wire Cloudflare Pages to the new API

In the Cloudflare dashboard:

1. **Pages → awards-dashboard → Settings → Environment variables**
2. Add **NODE_API_ORIGIN** = `https://api.captureradar.app` (or your VM's nginx URL)
3. **Pages → Deployments → Trigger redeploy** (or push any commit)

The `web/functions/_middleware.ts` reads `NODE_API_ORIGIN` and routes `/opportunities/*`, `/v1/*`, and `/admin/queues/*` to the Node API. Auth, legacy admin, and legacy data routes still hit the existing Worker.

If `NODE_API_ORIGIN` is unset, the middleware falls back to the legacy Worker for everything — the SPA still loads, but the new endpoints will 404. Useful for staging.

## 7. (Optional) DNS for the API origin

The VM is reachable at its public IP, but for nicer URLs:

1. **Cloudflare DNS** for your domain → add an `A` record `api.captureradar.app` → VM IP
2. **Proxy status: Proxied** (orange cloud) — gets you free TLS
3. The nginx config on the VM already accepts unencrypted HTTP (Cloudflare terminates TLS at the edge)

Cost: $0 if you already own a domain. If you don't, the `pages.dev` subdomain works as a fallback (see step 6 alt).

## 8. (Optional) Phase 0 frontend cutover

The Pages SPA already builds with the new react-router routes and the CaptureRadar brand. To redeploy:

```bash
# Locally
pnpm install
pnpm --filter @captureradar/web build
pnpm --filter @captureradar/web deploy
```

Or push to the deploy branch and let CI handle it — see `.github/workflows/deploy.yml`.

## 9. Cost guardrails

The deployment is engineered to stay at $0/mo, with these caps:

| Service | Free cap | What hits it |
|---|---|---|
| Cloudflare Pages | unlimited builds + 100K req/day routes | Frontend |
| Cloudflare Workers (free) | 100K req/day per worker | api-worker, sam-api-worker |
| Cloudflare R2 | 10 GB storage, 1M Class A ops/mo | Document attachments (~5K demo docs ≈ 8 GB) |
| Cloudflare Workers AI | 10K neurons/day | AI summaries, embeddings, chat |
| Oracle Always-Free VM | forever-free 4 cores / 24 GB / 200 GB | Postgres + Redis + API + worker |
| Resend | 100/day + 3K/mo | Saved-search email alerts |
| Anthropic API | $0 if `ANTHROPIC_API_KEY` blank | Disabled until budget unlocks |
| Postgres data | ≈10 M rows safely on the VM disk | Demo dataset is 3-5 GB |

The `WORKERS_AI_DAILY_BUDGET` env var (default 8000) hard-stops AI inference before the daily quota is exhausted. `INGESTION_MODE=mixed` runs free public APIs and seeds everything else.

## 10. Monitoring

```bash
# API
journalctl -u captureradar-api -f

# Worker
journalctl -u captureradar-worker -f

# Postgres
sudo -u postgres psql -d captureradar -c "SELECT relname, n_live_tup FROM pg_stat_user_tables ORDER BY n_live_tup DESC LIMIT 10;"

# Redis
redis-cli info stats | head -20

# Bull Board (admin role)
open https://awards-dashboard.pages.dev/admin/queues
```

## What's next (Phase 1)

After this runbook completes:
1. **Schema migration:** `pnpm --filter @captureradar/api-node db:generate && db:migrate` — creates all 30+ tables on Postgres.
2. **Ingestion seed:** queue up jobs in Bull Board (or POST `/admin/queues/*/jobs`) to seed reference data, NAICS/PSC, demo opportunities.
3. **Frontend pages:** the spec routes are stubbed — Phase 1 swaps each `<StubPage/>` for the real `DataTable` + `FilterPanel` + `EntityDetailLayout` combo.
4. **AI batch:** queue `ai_summarize_opps` + `ai_embed_opps` jobs. Workers AI fills the cached columns.
5. **Demo data verification:** open the dashboard, confirm 8K-80K opportunities render with AI summaries.

See `docs/PHASE_1_PLAN.md` (next).
