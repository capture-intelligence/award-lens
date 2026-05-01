# Overnight summary — 2026-04-30 → 2026-05-01

This is the autonomous-overnight log. Built, deployed, and tested while the user slept.

## ✅ What landed

### 1. mod_history bug fixed (the main fire)

**Root cause:** `enrich-descriptions.mjs` was calling
`https://api.usaspending.gov/api/v2/awards/transactions/` which 404s.
The actual endpoint is `https://api.usaspending.gov/api/v2/transactions/`
(no `/awards/` prefix). The script's catch treated 404 as "no
transactions" and returned `null` mod_history for every row in the
prior backfill (showing as `has_mod_history: 0` across 2,917 rows).

**Fix shipped:** commit `6a791bd` — URL corrected, `buildModHistory`
upgraded to include `action_type_description` ("EXERCISE AN OPTION")
and `federal_action_obligation` amount ("+$497K") when present.

**Result:** D1 now shows
```
total: 2923, stamped: 2923, has_description_long: 2919,
has_mod_history: 2921, has_any: 2923
```
**99.9% coverage on both fields.** The remaining 4 stragglers will
catch on the next daily timer fire.

**Surfaces in dashboard:** Tree tooltip and AwardDetail panel will
show the fuller `description_long` immediately. `mod_history` is
populated in D1 — front-end change to render it is tomorrow.

### 2. SAM.gov Opportunities ingest pipeline

Commit `708e955`. Full pipeline: migration `0015_solicitation.sql` →
`solicitation` + `solicitation_attachment` tables, worker routes
`POST /sidecar/solicitations/upsert` and
`POST /sidecar/solicitations/attachments/upsert` plus
`GET /sidecar/solicitations/stats` diagnostic, sidecar
`sync-sam-opportunities.mjs` pulling from
`/opportunities/v2/search` filtered by ncode=075 (HHS), systemd unit
+ daily 09:00 UTC timer.

**Status:** code deployed, **execution blocked overnight** by SAM.gov
daily quota exhaustion (existing exclusions cron consumed it before I
got there). Quota resets 2026-05-02 00:00 UTC. The systemd timer at
09:00 UTC tomorrow will likely also fail (still pre-reset). First
successful run will be at 09:00 UTC on 2026-05-02.

### 3. SAM.gov Vendor enrichment pipeline

Commit `e639863` + fix `257e31c` (cage_code already existed in 0001).
Full pipeline: migration `0016_vendor_sam_enrichment.sql` adds
`business_types`, `sam_status`, `sam_expires_at`, `vendor_naics_codes`,
`sam_enriched_at` columns + index. Worker routes:
`GET /sidecar/vendors/needing-sam-enrich`,
`POST /sidecar/vendors/sam-enrich`,
`GET /sidecar/vendors/sam-enrichment-stats`. Sidecar
`sync-sam-vendors.mjs` per-UEI lookup against
`/entity-information/v3/entities`. Systemd timer at daily 10:00 UTC.

**Status:** same as SAM Opportunities — code shipped, blocked by
quota until 2026-05-02 00:00 UTC.

### 4. Workers AI binding + Pattern A `/ai/ask`

Commits `a9ab76e` + `b874cbb`. Adds the `[ai]` binding to
`wrangler.toml` and a new `POST /ai/ask` endpoint that does:
- Step 1: route the query (STRUCTURED | SEMANTIC | GENERAL) using
  Llama 3.1 8B Instruct with a routing system prompt.
- Step 2: if STRUCTURED, extract structured filter params (agency,
  center, min/max value, date_range, natures) into JSON the dashboard
  can use to populate `/explore` directly.

**Smoke-tested live, all three paths work:**
- "show NCHHSTP contracts ending in 60 days under 5 million dollars"
  → STRUCTURED with `{center: "NCHHSTP", date_range: ["today", "today+60"], min_value: 5000000}`
- "find contracts about cybersecurity" → SEMANTIC
- "what is NCHHSTP" → GENERAL

**Known issue:** the params extractor confused `min_value` with
`max_value` in the smoke test ("under 5M" should be max). This is a
prompt-tuning issue, not infrastructure. Tomorrow: add a few-shot
example to the system prompt or train a LoRA with corrective
examples.

### 5. Resilience improvements (worker + sidecar)

- `description-enrich` worker route now coerces `award_id` from
  string/number/bigint (the prior `Number.isInteger` filter silently
  rejected every UUID-string PK — that's why the first 299 rows
  weren't actually persisted).
- Worker response now reports `accepted` / `applied` / `rejected`
  separately — sidecar logs warnings on partial-write mismatches.
- Sidecar tolerates 3 consecutive zero-applied batches before exiting
  (was 1 — caused premature exits on transient blips).
- New `POST /sidecar/awards/reset-missing-mod-history` endpoint to
  re-queue rows whose timestamps got stamped without data.

### 6. Workflow ops modes added

`run-enrichment.yml` gained these manual-trigger modes:
- `stats` — current enrichment counts
- `probe` — DNS / connectivity diagnosis
- `diag` — full network + USAspending probe
- `reset-mod-history` — clears stamps where mod_history is null
- `trigger-sam-opps` — fires the SAM Opps systemd service immediately
- `solicitations-stats` — counts of solicitations by notice type
- `trigger-vendor-enrich` — fires the SAM vendors service immediately
- `vendors-stats` — counts of vendors enriched / status
- `ai-smoke-test` — three-prompt /ai/ask validation

All read API_BASE / INGEST_TOKEN from the VM's .env via SSH — no new
repo secrets.

## ⚠ Two things you need to handle in the morning

### A. Cloudflare API token needs Vectorize:Edit scope

The existing `CLOUDFLARE_API_TOKEN` GitHub secret can't create
Vectorize indexes (error 10000 on
`/accounts/.../vectorize/v2/indexes`). Without Vectorize, the RAG /
semantic search path can't ship.

**Fix:** Cloudflare Dashboard → My Profile → API Tokens → edit the
existing token → add **Vectorize: Edit** permission → save.

After that, uncomment the `[[vectorize]]` block in
`workers/api/wrangler.toml` and re-add the create-index step in
`.github/workflows/deploy.yml` (currently commented). Push to deploy.
Pattern A `/ai/ask` works without Vectorize so this is a tomorrow fix.

### B. SAM.gov daily quota exhausted

Was consumed by the existing exclusions sync before our new pipelines
got a chance. Resets 2026-05-02 00:00 UTC. The new SAM Opps + Vendor
pipelines will start producing data on their daily timers naturally
once the quota frees.

If you want to test sooner: pause the exclusions cron temporarily
(`sudo systemctl stop awards-exclusions.timer awards-exclusions.service`)
and dispatch `gh workflow run "Run description enrichment" --ref main
-f mode=trigger-sam-opps`. Re-enable the exclusions timer after.

## What's queued / not yet built

- Embeddings backfill (depends on Vectorize → blocked until A is fixed)
- Pattern A UI panel ("Ask the data" search bar in the dashboard)
- mod_history rendering in AwardDetail panel
- CDC procurement forecasts scrape (skipped tonight — fragile HTML, low
  ROI vs SAM Opps which covers the same use case better)
- Phase 3a SOW PDF download → R2 (depends on SAM Opps producing data)

## Commits shipped tonight (chronological)

```
6a791bd fix(enrich): mod_history URL was wrong (/awards/transactions/ -> /transactions/)
3f7b9f1 chore(ci): add reset-mod-history mode to clear timestamps for re-sweep
708e955 feat(opportunities): SAM.gov Contract Opportunities ingest pipeline
e639863 feat(vendors): SAM Entity API enrichment + workflow trigger modes
257e31c fix(migration): drop cage_code ALTER -- column already exists from 0001
839ff38 fix(ci): trigger modes dump full journal on failure for diagnosis
a9ab76e feat(ai): Workers AI + Vectorize bindings + Phase 0 /ai/ask endpoint
b874cbb fix(deploy): defer Vectorize binding -- API token lacks Vectorize:Edit
354e16b fix(ci): pages deploy passes ascii commit message (wrangler v4 utf-8 strict)
8787bf5 chore(ci): add ai-smoke-test mode for Pattern A endpoint validation
4c6f467 fix(ci): smoke-test query avoids dollar-sign shell expansion
```

## Concrete proof / verification commands

Run any of these to verify what landed:

```bash
# Description enrichment counts
gh workflow run "Run description enrichment" --ref main -f mode=stats

# Workers AI smoke test
gh workflow run "Run description enrichment" --ref main -f mode=ai-smoke-test

# (After 2026-05-02 00:00 UTC, when SAM quota resets)
gh workflow run "Run description enrichment" --ref main -f mode=trigger-sam-opps
gh workflow run "Run description enrichment" --ref main -f mode=solicitations-stats
gh workflow run "Run description enrichment" --ref main -f mode=trigger-vendor-enrich
gh workflow run "Run description enrichment" --ref main -f mode=vendors-stats
```

## Next session priorities (suggested)

1. **Add Vectorize:Edit scope to Cloudflare API token** (item A above)
2. **Re-enable Vectorize binding + uncomment create-index step**
3. **Build embeddings backfill endpoint** (POST /ai/embed-awards-batch
   that processes ~50 awards/call, cron'd via a workflow that loops
   it ~60 times to cover the full 2,923-row corpus)
4. **Build the Pattern A UI panel** ("Ask the data" search bar that
   POSTs to /ai/ask and populates the existing filter pills with the
   returned params)
5. **Fix the min/max prompt issue** with a few-shot example or LoRA
6. **Surface mod_history in AwardDetail** (front-end render; data
   already in D1)
