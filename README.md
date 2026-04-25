# Federal Awards Data Pipeline — Cloudflare Free + Oracle Sidecar Edition

A hybrid pipeline that replicates federal contracting data from **USAspending.gov**, **Grants.gov**, and (optionally) **SAM.gov** into a queryable warehouse. Cloudflare's Free tier hosts the API + dashboard + D1 warehouse; an Oracle Cloud Always-Free VM runs the daily ingestion via systemd timers.

**Cost: ~$0/month forever** (Cloudflare Free tier + Oracle Always Free).

> **Status:** Production-deployed reference implementation. The setup walkthroughs below assume you'll fork and stand up your own Cloudflare account; nothing in this repo grants access to anyone else's deployment.

## License

MIT — see [LICENSE](./LICENSE). Use freely, with no warranty. Cloudflare and US federal data sources have their own terms (USAspending and Grants.gov data are public domain; SAM.gov requires an account for some endpoints — see their TOS).

## ⚠️ Required user-specific setup

This repo intentionally commits placeholder Cloudflare resource IDs (`workers/*/wrangler.toml` `database_id`, `kv_namespaces.id`) that point at the original author's account. You **must** replace them with IDs from your own Cloudflare account before deploying — or run [`scripts/bootstrap.mjs`](./scripts/bootstrap.mjs) which does this automatically.

Secrets that must be set in your own environment (never in code):
- **`SAM_GOV_API_KEY`** — only if you use the SAM.gov enrichment worker
- **`INGEST_TOKEN`** — shared secret between the api-worker and the Oracle sidecar (random 64 hex chars)

Both are loaded via `wrangler secret put` (production) or `.dev.vars` (local). See the [Secret Management](#secret-management) section below.

## What's in the box

| Component | Path | Role |
|---|---|---|
| Shared types, adapters, upsert logic | `packages/core` | TypeScript package imported by api-worker |
| D1 migrations | `packages/migrations` | Schema + SAM exclusion + sam_api_budget tables |
| **Read API + admin endpoints** | `workers/api` | Hono REST API; ingestion + reconciliation orchestrated via token-protected `/admin/*` and `/import/*` routes |
| **SAM API enrichment** | `workers/sam-api` | Stateless on-demand vendor enrichment, D1-backed daily 10-req budget |
| **Dashboard** | `web/public` | Cloudflare Pages static site (Alpine + Chart.js, no build step) |
| **Oracle VM sidecar** | `sidecar-oracle/` | Node scripts on systemd timers — handle all ingestion (USAspending, Grants.gov, reconciliation) |

## Architecture (Path B — hybrid)

```
                         Oracle Cloud Always-Free VM
                  ┌──────────────────────────────────┐
                  │ systemd timers (daily UTC):       │
                  │   awards-sidecar       06:00      │  → USAspending API
                  │   awards-grants        08:30      │  → Grants.gov API
                  │   awards-reconcile     Sun 12:00  │  → reconciliation
                  └────────────────┬─────────────────┘
                                   │  HTTPS + Bearer INGEST_TOKEN
                                   ▼
                  ┌──────────────────────────────────┐
                  │ Cloudflare Free tier              │
                  │   api-worker  (REST + /admin/*)   │
                  │   sam-api-worker (on-demand)      │
                  │   D1 (warehouse) + KV (META) + R2 │
                  │   Pages (dashboard)               │
                  └────────────────┬─────────────────┘
                                   │ reads
                                   ▼
                          https://awards-dashboard.pages.dev
```

Key design choices:
- **Compute on Oracle, data on Cloudflare.** The VM does work that requires unrestricted egress (USAspending's WAF rejects Cloudflare edge IPs at TLS layer); the warehouse + dashboard live on Cloudflare's edge for low-latency reads.
- **Token-authed import endpoints.** Sidecar scripts post normalized batches to `/admin/*` and `/import/*` with `Authorization: Bearer $INGEST_TOKEN`.
- **Atomic D1 upserts.** Every batch is `db.batch([...])` so it's all-or-nothing per record.
- **External ID mapping.** Source-agnostic schema; adding a new data source is one adapter + one VM script.
- **Deterministic internal IDs.** Re-runs are idempotent.

## Authentication & Access Control

The dashboard requires a signed-in, admin-approved user. Two OAuth providers are wired in; you only need to configure one.

| Setting | Where it lives | Required? |
|---|---|---|
| `INGEST_TOKEN` | api-worker secret | **Required** — protects `/admin/*` and `/import/*` machine endpoints |
| `GOOGLE_CLIENT_ID` + `GOOGLE_CLIENT_SECRET` | api-worker secrets | Optional — disable Google sign-in if not set |
| `MICROSOFT_CLIENT_ID` + `MICROSOFT_CLIENT_SECRET` | api-worker secrets | Optional — disable Microsoft sign-in if not set |
| `MICROSOFT_TENANT_ID` | api-worker var | Optional — defaults to `common` (any Entra tenant + personal MSA accounts) |
| `AUTH_REDIRECT_URL` | api-worker var | Optional — the dashboard URL to land on after sign-in. Defaults to `https://awards-dashboard.pages.dev` |

### How approval works

1. Anyone visits the dashboard → sees the sign-in screen
2. They click **Continue with Google** or **Continue with Microsoft**
3. After OAuth, they land on a **"Awaiting approval"** page
4. An admin (the `algocrat@gmail.com` account is auto-promoted on first login) goes to **User Management** in the dashboard sidebar
5. Admin clicks **Approve** — that user can now access the dashboard
6. Admin can also reject, demote, or change roles. Rejected users see an "access denied" screen and their sessions are revoked.

### Roles

| Role | Can sign in? | Can read warehouse? | Can manage users? |
|---|---|---|---|
| `pending` | yes — sees waiting screen | no | no |
| `user` | yes | yes | no |
| `admin` | yes | yes | yes |
| `rejected` | sees denied screen | no | no |

### Setting up Google OAuth (5 minutes)

1. Go to https://console.cloud.google.com/apis/credentials
2. **Create credentials** → **OAuth 2.0 Client ID**
3. Application type: **Web application**
4. Name: `Awards Dashboard`
5. **Authorized redirect URIs**: add `https://api-worker.<your-subdomain>.workers.dev/auth/google`
6. Click **Create**, copy the Client ID and Client secret
7. Set them on the worker:

```powershell
cd workers/api
echo "<your-client-id>"     | npx wrangler secret put GOOGLE_CLIENT_ID
echo "<your-client-secret>" | npx wrangler secret put GOOGLE_CLIENT_SECRET
npx wrangler deploy
```

### Setting up Microsoft OAuth (5 minutes)

1. Go to https://portal.azure.com → **Microsoft Entra ID** → **App registrations**
2. **New registration**
   - Name: `Awards Dashboard`
   - Supported account types: pick the right one for your needs (most common: "Accounts in any organizational directory and personal Microsoft accounts")
   - Redirect URI: **Web** → `https://api-worker.<your-subdomain>.workers.dev/auth/microsoft`
3. Click **Register**, copy the **Application (client) ID** from the overview page
4. Left sidebar → **Certificates & secrets** → **New client secret** → copy the **Value** (not the ID)
5. Left sidebar → **API permissions** → confirm **Microsoft Graph → User.Read** is granted (it's the default)
6. Set on the worker:

```powershell
cd workers/api
echo "<application-client-id>" | npx wrangler secret put MICROSOFT_CLIENT_ID
echo "<client-secret-value>"   | npx wrangler secret put MICROSOFT_CLIENT_SECRET
# Optional — restrict to a single Entra tenant. Use 'common' for any tenant + personal accounts.
echo "common"                  | npx wrangler secret put MICROSOFT_TENANT_ID
npx wrangler deploy
```

### Bootstrap admin

The hardcoded email `algocrat@gmail.com` becomes admin on its first sign-in (regardless of provider). Change `ADMIN_BOOTSTRAP_EMAIL` in `workers/api/src/auth/routes.ts` if you fork this repo.

### Auth API endpoints

| Endpoint | Auth | Purpose |
|---|---|---|
| `GET /auth/me` | none | returns `{ authenticated, user }` |
| `GET /auth/google` | none | starts Google OAuth (or handles callback) |
| `GET /auth/microsoft` | none | starts Microsoft OAuth (or handles callback) |
| `POST /auth/logout` | session | clears the session |
| `GET /admin/users` | admin role | list all users (filter `?role=pending`) |
| `GET /admin/users/:id` | admin role | single user + audit trail |
| `POST /admin/users/:id/approve` | admin role | mark as `user` |
| `POST /admin/users/:id/reject` | admin role | mark as `rejected`, revoke sessions |
| `POST /admin/users/:id/role` | admin role | set role to any value |
| `GET /admin/stats/users` | admin role | counts by role |

## Secret Management

| Item | Type | Where it lives | In git? |
|---|---|---|---|
| `SAM_GOV_API_KEY` | Secret | `wrangler secret put` (prod), `workers/sam-api/.dev.vars` (local) | ❌ Never |
| `INGEST_TOKEN` | Secret | `wrangler secret put` (prod api-worker), `sidecar-oracle/.env` on the VM | ❌ Never |
| `GOOGLE_CLIENT_ID` / `_SECRET` | Secret | `wrangler secret put` on api-worker | ❌ Never |
| `MICROSOFT_CLIENT_ID` / `_SECRET` | Secret | `wrangler secret put` on api-worker | ❌ Never |
| Cloudflare D1 / KV IDs | Public identifier | `workers/*/wrangler.toml` | ✅ Yes (they're not credentials — knowing them grants no access) |
| `algocrat.workers.dev` URLs | Public identifier | various source files | ✅ Yes (you should swap to your own subdomain when forking) |
| Account-specific OCIDs | Public identifier | none committed | ✅ Yes when needed |

**`.gitignore` enforcement** — `.dev.vars`, `.env`, `keys/`, `.bootstrap-state.json`, `.oci-tmp/`, and `*ssh-key*` are all blocked from accidental commit. Verify in your fork before pushing.

If you ever **clone this repo and immediately push to your own GitHub**, do a quick audit:

```bash
git ls-files | xargs grep -lE "(SAM-[a-f0-9-]{36}|github_pat_|ghp_|sk-|AKIA[A-Z0-9]{16})" 2>/dev/null
# (no output = clean)
```

## Prerequisites

- Node 20+ and `pnpm` (`npm i -g pnpm`)
- Cloudflare account (free works for dev; Workers Paid plan required for Queues + Workflows — $5/mo)
- `wrangler` CLI authenticated: `npx wrangler login`

## One-time setup

```bash
# 1. Install
pnpm install

# 2. Create Cloudflare resources
npx wrangler d1 create awards-warehouse
# → copy the database_id from the output

npx wrangler r2 bucket create awards-staging

npx wrangler kv namespace create META
# → copy the id

npx wrangler queues create normalize-queue
npx wrangler queues create upsert-queue
npx wrangler queues create sam-enrich-queue
npx wrangler queues create dlq

# SAM.gov API key (only needed to deploy sam-api-worker)
cd workers/sam-api && npx wrangler secret put SAM_GOV_API_KEY && cd ../..

# 3. Paste the IDs into every wrangler.toml that has `REPLACE_WITH_YOUR_*`
#    (workers/api, workers/scheduler, workers/usaspending-workflow,
#     workers/normalizer, workers/upsert)

# 4. Apply the migration to your remote D1
npx wrangler d1 migrations apply awards-warehouse --remote \
  --config workers/api/wrangler.toml
```

## Deploy everything

```bash
pnpm -r --filter "./workers/*" deploy
```

Or one at a time:

```bash
cd workers/api                   && npx wrangler deploy && cd ../..
cd workers/usaspending-workflow  && npx wrangler deploy && cd ../..
cd workers/sam-bulk-workflow     && npx wrangler deploy && cd ../..
cd workers/grants-gov-workflow   && npx wrangler deploy && cd ../..
cd workers/sam-api               && npx wrangler deploy && cd ../..
cd workers/scheduler             && npx wrangler deploy && cd ../..
cd workers/normalizer            && npx wrangler deploy && cd ../..
cd workers/upsert                && npx wrangler deploy && cd ../..
```

### Deploy the dashboard (Cloudflare Pages)

```bash
cd web
pnpm install
# Edit public/config.js — set API_BASE to your deployed api-worker URL
pnpm deploy
# → Cloudflare prints the *.pages.dev URL
```

You can also leave `config.js` alone and override the API URL from the dashboard itself (the input at the top of the page persists to localStorage).

## First data pull

Kick off an initial backfill (one fiscal year at a time keeps memory sane):

```bash
# Local trigger against a deployed workflow
curl -X POST https://usaspending-workflow.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{
        "mode": "backfill",
        "sinceIso": "2024-10-01T00:00:00Z",
        "untilIso": "2025-09-30T23:59:59Z",
        "maxPages": 500
      }'
```

Or via scheduler's manual trigger:

```bash
curl -X POST https://scheduler-worker.<your-subdomain>.workers.dev/trigger/usaspending \
  -H 'Content-Type: application/json' \
  -d '{"mode":"incremental"}'
```

Trigger the SAM bulk sync (downloads the daily public exclusions extract, no API key):

```bash
curl -X POST https://sam-bulk-workflow.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"extracts":["exclusions"]}'
```

Trigger a Grants.gov sync (pulls posted + forecasted opportunities):

```bash
# All open opportunities
curl -X POST https://grants-gov-workflow.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"statuses":["posted","forecasted"]}'

# Filtered to a specific agency + enriched with full detail per opportunity
curl -X POST https://grants-gov-workflow.<your-subdomain>.workers.dev \
  -H 'Content-Type: application/json' \
  -d '{"statuses":["posted"],"agencies":["HHS-CDC"],"enrichDetail":true,"maxRecords":500}'
```

Trigger reconciliation manually (normally runs weekly via cron):

```bash
curl -X POST https://scheduler-worker.<your-subdomain>.workers.dev/trigger/reconcile
# → {"checksRun":20,"driftCount":2,"errors":0}
```

Backfill toptier agency codes (required once, before reconciliation can query source rollups):

```bash
curl -X POST https://scheduler-worker.<your-subdomain>.workers.dev/trigger/backfill-toptier-codes
# → { "totalAgencies": 115, "matchedExact": 47, "matchedCaseInsensitive": 12,
#     "matchedAlias": 0, "unmatched": [...], "durationMs": 820 }
```

Reconciliation self-heals: if zero orgs have toptier codes, the first run performs this backfill automatically. Running it manually is useful after ingesting a new agency and wanting the match to take effect before the next Sunday.

Enrich a single vendor via the SAM.gov API (consumes 1 of 10 daily budget slots):

```bash
# Queue for async enrichment (preferred — respects budget, doesn't block)
curl -X POST https://api-worker.<your-subdomain>.workers.dev/vendors/<vendor_id_or_uei>/enrich

# Synchronous — returns the SAM response immediately, fails fast if budget is out
curl -X POST 'https://api-worker.<your-subdomain>.workers.dev/vendors/<uei>/enrich?mode=sync'

# Check budget
curl https://api-worker.<your-subdomain>.workers.dev/sam-api/status
# → { "used": 3, "limit": 10, "remaining": 7, "resetsAt": "2026-04-23T00:00:00.000Z" }
```

Watch progress:

```bash
# Live worker logs
npx wrangler tail usaspending-workflow
npx wrangler tail sam-bulk-workflow
npx wrangler tail grants-gov-workflow
npx wrangler tail normalizer-worker
npx wrangler tail upsert-worker
npx wrangler tail scheduler-worker

# Check ingestion runs via the API
curl https://api-worker.<your-subdomain>.workers.dev/runs
```

## Verify data arrived

```bash
curl https://api-worker.<your-subdomain>.workers.dev/stats/overview
curl https://api-worker.<your-subdomain>.workers.dev/stats/top-vendors
curl https://api-worker.<your-subdomain>.workers.dev/awards/expiring/18
curl https://api-worker.<your-subdomain>.workers.dev/awards?q=tuberculosis
```

## Local development

Each worker can run locally against a local D1:

```bash
# Apply migration locally
npx wrangler d1 migrations apply awards-warehouse --local \
  --config workers/api/wrangler.toml

# Run API locally
cd workers/api && npx wrangler dev
# → http://localhost:8787
```

`wrangler dev` simulates Queues, R2, KV, and D1 locally. Workflows in local mode have some limitations — best to test end-to-end against a dev Cloudflare account.

## Adding a new source

1. Create a new adapter in `packages/core/src/adapters/<source>.ts` extending `BaseSourceAdapter`.
2. Add a new workflow worker under `workers/<source>-workflow/` (copy `usaspending-workflow` as a template).
3. Add an entry to `source_system` in a new migration.
4. Add a cron line in `workers/scheduler/wrangler.toml`.
5. Deploy.

No changes to the normalizer, upsert worker, or warehouse schema.

## Key REST endpoints

| Endpoint | Purpose |
|---|---|
| `GET /stats/overview` | totals: awards, vendors, orgs, $obligated |
| `GET /stats/top-vendors?limit=20` | leaderboard |
| `GET /stats/by-agency` | spend by awarding agency |
| `GET /awards?q=&awarding_org=&vendor=&min_value=&limit=` | search |
| `GET /awards/:id` | single award detail |
| `GET /awards/expiring/:months` | recompete pipeline |
| `GET /vendors?q=&limit=` | vendor search |
| `GET /vendors/:idOrUei` | vendor detail + top awards |
| `GET /organizations` | agency/office rollup |
| `GET /runs` | ingestion history |
| `GET /health` | last run + reconciliation snapshot |
| `GET /exclusions?q=&active=true` | SAM debarred/suspended search |
| `GET /exclusions/by-uei/:uei` | all exclusions for a UEI |
| `GET /vendors/:id/exclusion-status` | is this vendor currently excluded? |
| `GET /opportunities?q=&agency=&status=posted&active=true` | Grants.gov opportunity search |
| `GET /opportunities/:id` | full opportunity record |
| `GET /stats/opportunities-by-agency` | open-funding rollup by agency |
| `GET /reconciliation/latest` | most recent check per dimension |
| `GET /reconciliation/history?dimension_value=...` | check history for one agency |
| `GET /reconciliation/summary` | counts of ok/drift/error/no_data |
| `POST /vendors/:id/enrich` | queue a SAM API enrichment |
| `POST /vendors/:id/enrich?mode=sync` | synchronous enrich (uses budget immediately) |
| `GET /sam-api/status` | remaining SAM API budget for today |
| `GET /schedule/status` | per-source schedule + last run + next run + health |

## Operational notes

- **Rate limiting**: USAspending has no hard cap but requests ~≤60/min. Workflow paces at ~40/min (`PACE_MS = 1500`).
- **D1 soft limit**: 5 GB per database. At ~1M awards you're fine; beyond that, partition staging into a separate DB.
- **Dead letter queue**: anything that fails 3× ends up in `dlq`. Build a simple admin route to replay from DLQ when issues are fixed.
- **Cost at small scale**: ~$15/mo (Workers Paid $5 + D1 writes ~$10). See design doc for bigger-scale numbers.

## SAM.gov API enrichment — usage policy

The `sam-api-worker` deliberately treats the 10-requests/day public-tier quota as scarce:

- **Default mode: on-demand.** No cron. Every slot is reserved for work driven by a human click or a specific workflow trigger (new award > $X, UEI flagged by a compliance check, etc.).
- **One Durable Object (`SamApiBudget`) enforces the quota.** Every path through the worker — queue consumer, HTTP endpoint, scheduled rotation — acquires a slot from the DO before calling SAM. This prevents races between concurrent invocations.
- **Queue-first.** The API worker's `POST /vendors/:id/enrich` enqueues a message rather than hitting SAM synchronously. This is the recommended UX: the user gets an instant response, the enrichment completes in the background, and overflow past the budget retries tomorrow instead of erroring.
- **Sync mode is available** (`?mode=sync`) when a caller genuinely needs the data now — returns 429 if the budget is exhausted.
- **Each SAM call returns up to 100 entities.** A single slot can enrich many vendors when batched by UEI list (the rotation path does this).

### Optional scheduled rotation

`workers/sam-api/wrangler.toml` has commented-out cron lines. Un-comment exactly one:

- **Conservative** (1 call/day): refreshes the 100 most-active vendors with stale (>30d) SAM data every day. Leaves 9 slots for on-demand.
- **Aggressive** (10 calls/day): refreshes 1000 vendors/day. Leaves 0 slots for on-demand — only do this if nobody triggers enrichment interactively.

My recommendation: **leave cron disabled**, use queue-only, and add the rotation only if a concrete need for background refresh emerges.

## Toptier agency backfill

USAspending's agency rollup endpoints key off a 3-digit `toptier_code` (e.g., `097` = DOD). Our `organization` table stores these in `external_ids_json`. The backfill:

1. Calls `GET /api/v2/references/toptier_agencies/` (public, no key).
2. For each returned agency, tries to match a row in `organization` by canonical name (exact → case-insensitive → alias).
3. Writes the toptier code + abbreviation into `external_ids_json`.

Run it manually via `POST /trigger/backfill-toptier-codes`, or let the reconciliation job auto-run it on first invocation.

## Extending

- **FPDS-NG ATOM feed** — useful for cross-validation against USAspending.
- **SAM entity delta extract** — the adapter and workflow already know about `entity_delta`; to enable, flip the extracts array in the scheduler to `['exclusions','entity_delta']` and add a case in `sam-bulk-workflow/src/index.ts#parseAndUpsert` that maps entity rows to the `vendor` table.
- **More reconciliation dimensions** — `workers/scheduler/src/reconciliation.ts` currently audits toptier agencies for the current FY. Add NAICS-level or subagency-level checks by reading more USAspending rollup endpoints and emitting rows with `dimension_type = 'naics'` etc. — the `reconciliation_check` table + `v_reconciliation_latest` view already support this.

## SAM.gov extract notes

- The adapter hits the public `/api/prod/fileextractservices/v1/api/download/...` URLs. These require **no API key**, but SAM has been known to change URL patterns — if a run returns HTML instead of a ZIP, visit https://sam.gov/data-services and update `SAM_EXTRACTS` in `packages/core/src/adapters/sam-bulk.ts`.
- The **full** entity extract is ~500MB/day and will exceed a Worker's memory. Use the delta extract (~50MB) instead.
- The exclusions extract is small (~10MB) and runs comfortably in a single Workflow step.

## Schedule page — refresh cadence & health at a glance

The **Schedule** tab in the dashboard (and `GET /schedule/status` on the API) gives you one-look answers to:

- When did each source last run?
- When will it run next?
- Is it healthy, stale, running, or errored?
- How much SAM API budget is left today?

**Health logic** per source:
- `running` — a row in `ingestion_run` has `status='running'`
- `never_run` — no rows yet for that `source_id`
- `error` — last run's status is `failed`
- `stale` — last run's `started_at` is older than the per-source threshold (28h for daily sources, 8 days for weekly reconciliation)
- `healthy` — within threshold
- `disabled` — source is on-demand only (e.g., SAM API worker with cron commented out)

**Schedule catalog** is defined in [workers/api/src/schedule.ts](workers/api/src/schedule.ts). Keep it in sync with the cron lines in [workers/scheduler/wrangler.toml](workers/scheduler/wrangler.toml) — the dashboard computes next-fire times client-side from the catalog, not by parsing cron at runtime.

The page **auto-refreshes every 60 seconds** while open and stops polling when you navigate away.

## Reconciliation — how drift is detected

A weekly job (Sunday 12:00 UTC) in the scheduler worker:
1. Reads the top 20 awarding agencies from the warehouse (by current-FY total obligated).
2. Calls USAspending's per-agency rollup endpoint (`/agency/{toptier}/obligations_by_award_category/`) for the same FY.
3. Compares the two contract totals:
   - `<= 5%` drift → `ok`
   - `> 5%` drift → `drift` (your warehouse may be stale, filtered differently, or missing recent modifications)
   - source returns nothing → `no_data` (often means the agency has no FY activity or the toptier_code wasn't captured from USAspending)
   - error reaching the source → `error`
4. Writes one row per agency to `reconciliation_check`. The `v_reconciliation_latest` view surfaces only the newest check per agency × FY.
5. The `Data Quality` dashboard tab groups these into ok/drift/error/no_data counts with per-row notes.

To widen the audit (e.g., add subagency or NAICS checks), extend `workers/scheduler/src/reconciliation.ts` — the table already supports any `dimension_type` value.

## License

MIT or whatever you like — this is starter code.
