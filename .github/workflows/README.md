# GitHub Actions — deployment pipeline

Two workflows live here:

| File | Trigger | What it does |
|------|---------|--------------|
| `ci.yml`     | push or PR to `main` / `production` | Type-checks the dashboard, dry-run-bundles the worker, syntax-checks all sidecar `*.mjs`. Fast, no secrets needed. |
| `deploy.yml` | push to `main` / `production` (or manual dispatch) | Applies D1 migrations → deploys api-worker → builds + deploys Pages site → ssh's into Oracle VM and refreshes sidecar scripts + systemd timers. |

## Required GitHub repo secrets

Set these once at **Settings → Secrets and variables → Actions → New repository secret**:

| Secret | Value | How to get it |
|--------|-------|----------------|
| `CLOUDFLARE_API_TOKEN` | API token with `Account → Workers Scripts: Edit`, `Account → Cloudflare Pages: Edit`, `Account → D1: Edit` | dash.cloudflare.com → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template + add D1 + Pages perms |
| `CLOUDFLARE_ACCOUNT_ID` | `f91a8ed8d60f3830e1821866fa2857e5` | dash.cloudflare.com → right sidebar on any page (already known) |
| `VM_HOST` | `129.158.208.18` | Oracle Cloud → Compute → your instance public IP |
| `VM_USER` | `ubuntu` | The Linux user that owns `/opt/awards-pipeline` (the awards user runs the timers but ubuntu is the SSH login) |
| `VM_SSH_KEY` | Contents of `keys/oracle/ssh-key-2026-04-23.key` (the **private** key — single-line text including `-----BEGIN…-----` and `-----END…-----`) | Same key currently in `~/keys/oracle/` on your laptop. Paste the entire file contents into the secret value. |

> ⚠️ **Don't commit the SSH key file.** `.gitignore` already blocks `keys/`. The secret in GitHub stays encrypted at rest.

## How it works in practice

After secrets are set:

```
git push origin main
   │
   ├─► ci.yml fires           — type-check & build (succeeds in ~90s)
   ├─► deploy.yml fires
   │     ├─► worker     job   — D1 migrations + wrangler deploy api-worker (~1 min)
   │     ├─► pages      job   — pnpm run build + wrangler pages deploy (~2 min)
   │     └─► sidecar    job   — scp .mjs / systemd files to VM + reload timers (~30s)
   │
   └─► All three jobs run in parallel.
```

A failed deploy is rolled back automatically by Cloudflare (previous version stays live). The Oracle VM is the only piece without atomic rollback — but the sidecar scripts are idempotent, so the worst case is a stale `*.mjs` until the next push.

## Manual deploys

You can still run `wrangler deploy` from your laptop — the pipeline is additive, not exclusive. But once the pipeline is green, prefer `git push` so you have an audit trail in the Actions tab.

## Targeted redeploy

GitHub UI → Actions → Deploy → Run workflow → "Targets: worker" (or `pages`, or `sidecar`, or any comma list). Useful when you've only changed sidecar scripts and don't need the full 4-minute pipeline.
