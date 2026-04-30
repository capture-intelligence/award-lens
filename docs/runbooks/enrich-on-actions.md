# Running enrichment on GitHub Actions (no VM)

When the Oracle sidecar is unavailable (IP-banned, decommissioned, or you just don't want to spin one up), the same `enrich-descriptions.mjs` script can run directly on a GitHub-hosted runner via the `Enrich descriptions (Actions runner)` workflow.

Pros:
- **Zero infrastructure**: no VM to maintain.
- **Fresh IP each run**: every dispatch lands on a different Azure-pool IP, so a single botched run doesn't burn future runs.
- **6-hour cap**: a backfill of ~7K rows fits comfortably with conservative pacing (`PACE_MS=2500` × 7K rows ≈ 5 hours).

Cons:
- **Pay-as-you-go minutes** for private repos (2,000 free/month, then ~$0.008/min). For backfills this is pennies; ongoing maintenance you'd want elsewhere.
- **No persistence**: each run is fresh. If you cancel mid-run, the script's stamping behavior preserves progress (rows that successfully enriched stay enriched; ones that didn't are still in the queue).

## One-time setup — repo secrets

Add these via **Settings → Secrets and variables → Actions** (or `gh secret set`):

| Secret | Value |
|---|---|
| `API_BASE` | `https://api-worker.<your-subdomain>.workers.dev` (the api-worker URL — same one in the VM's `.env`) |
| `INGEST_TOKEN` | Same value as `INGEST_TOKEN` in the VM's `.env` and the worker's environment |

```bash
gh secret set API_BASE -b "https://api-worker.<subdomain>.workers.dev"
gh secret set INGEST_TOKEN -b "<token>"
```

## Running it

```bash
# Single batch (~50 awards, finishes in 1-2 min)
gh workflow run "Enrich descriptions (Actions runner)" -f mode=incremental

# Full backfill (loops until every eligible row is enriched, ~5h with conservative pacing)
gh workflow run "Enrich descriptions (Actions runner)" -f mode=backfill
```

Optional overrides if you want to push faster (only do this if you're confident USAspending isn't currently rate-limiting):

```bash
gh workflow run "Enrich descriptions (Actions runner)" \
  -f mode=backfill \
  -f pace_ms=1000 \
  -f batch_size=50
```

## What if a run fails

- **"fetch failed" / TLS errors right at the start**: USAspending may now be range-banning Azure too, which would be unusual but possible. Wait an hour and retry. If still failing, the worker proxy task (queued separately) becomes the only viable path.
- **Run hits the 350-min cap mid-backfill**: just dispatch `mode=backfill` again. The script picks up from where it left off (rows already enriched are skipped via `description_enriched_at`).
- **Worker rejects with 401**: `INGEST_TOKEN` is wrong. Re-set the secret.
- **Worker returns 0 rows in `/sidecar/awards/needing-description-enrich`**: enrichment is done, or the failed-run cleanup wasn't done yet (see the reset section in `new-sidecar-vm.md`).

## Cost note

For a 5-hour backfill: 5 × 60 = 300 min. With the 2,000-min free tier, you can run ~6 full backfills/month before any charge. After that, ~$0.008/min × 300 min ≈ $2.40 per backfill. Effectively free.
