# @captureradar/api-node

Node.js API for CaptureRadar — Hono server, Drizzle ORM on Postgres, Redis-backed BullMQ workers.

Runs on the Oracle Always-Free VM alongside Postgres 16 and Redis. Cloudflare Pages serves the frontend; the Cloudflare Worker at [`workers/api`](../../workers/api) handles OAuth issuance and proxies all data requests to this service.

## Layout

```
apps/api-node/
├── src/
│   ├── index.ts              ← Hono server entry
│   ├── env.ts                ← Zod-validated env loader
│   ├── redis.ts              ← ioredis clients (general + BullMQ-dedicated)
│   ├── auth/
│   │   └── session.ts        ← cookie → Postgres session lookup, RBAC middleware
│   ├── db/
│   │   ├── index.ts          ← drizzle + node-postgres pool
│   │   ├── custom-types.ts   ← pgvector + tsvector wrappers
│   │   ├── migrate.ts        ← `pnpm db:migrate`
│   │   └── schema/           ← 30+ tables for spec §4 entities
│   ├── routes/
│   │   ├── health.ts         ← /health, /health/ready
│   │   ├── auth.ts           ← /auth/me, /auth/logout
│   │   ├── opportunities.ts  ← /opportunities/contract, /grant, /forecasts
│   │   └── stub.ts           ← stubbed list endpoints (Phase 1)
│   └── queues/
│       ├── index.ts          ← queue registry
│       ├── worker.ts         ← worker process entry
│       ├── dashboard.ts      ← Bull Board UI at /admin/queues
│       └── jobs/base.ts      ← BaseIngestionJob with run-row bookkeeping
├── deploy/                   ← Oracle VM bootstrap + systemd units
├── drizzle.config.ts
├── tsconfig.json
└── package.json
```

## Local development

Postgres 16 + Redis on `localhost`:

```bash
# 1. Install (once)
brew install postgresql@16 redis     # or apt / dnf — see deploy/install.sh
brew services start postgresql@16
brew services start redis

# 2. Create the DB
createdb captureradar
psql captureradar -c 'CREATE EXTENSION IF NOT EXISTS pg_trgm;
                     CREATE EXTENSION IF NOT EXISTS pgcrypto;
                     CREATE EXTENSION IF NOT EXISTS vector;'

# 3. Configure
cp .env.example .env
# Edit DATABASE_URL + REDIS_URL if not localhost defaults.

# 4. Generate + apply schema
pnpm --filter @captureradar/api-node db:generate     # writes drizzle/*.sql
pnpm --filter @captureradar/api-node db:migrate

# 5. Run
pnpm --filter @captureradar/api-node dev   # API on :3000
pnpm --filter @captureradar/api-node queue:dashboard  # Bull Board on :3001
```

`tsx watch` reloads on save; no rebuild step.

## Production deploy

See [deploy/install.sh](deploy/install.sh) for the one-shot Oracle VM bootstrap. After the VM is up:

```bash
cd /opt/captureradar/apps/api-node
pnpm install --frozen-lockfile
pnpm build
sudo systemctl restart captureradar-api captureradar-worker
```

Logs:
```bash
journalctl -u captureradar-api -f
journalctl -u captureradar-worker -f
```

## Auth model

OAuth (Google + Microsoft) is still issued by [workers/api/src/auth](../../workers/api/src/auth/routes.ts). The Worker writes the session row to Postgres and sets the cookie. This Node API:

1. reads the cookie on every request,
2. looks up the user in `app_session` joined to `app_user`,
3. attaches the user to `c.var.user`,
4. enforces RBAC via `requireAuth`, `requireApproved`, `requireAdmin`.

Both processes share the same Postgres database. There's exactly one source of truth for sessions.

## Cost guardrails

This service is designed to run at $0/mo on Oracle Always-Free + free public-tier APIs. Specifically:

- Postgres on the VM (200 GB disk, 24 GB RAM ARM tier) — no managed-DB cost.
- Redis on the VM — same VM, same $0.
- Workers AI free tier (10K neurons/day) — `WORKERS_AI_DAILY_BUDGET` enforces a cap.
- Anthropic disabled by default; `ANTHROPIC_API_KEY` blank ⇒ all AI flows route to Workers AI (Llama 3.3 + bge-base).
- `INGESTION_MODE=mixed` runs real ingestion only for free-API sources; everything else is seeded.
