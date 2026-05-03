# AwardLens — Architecture Overview

> Capture Intelligence · `award-lens` (this repo) + `award-lens-models`
> ([github.com/capture-intelligence](https://github.com/capture-intelligence))

This document is the canonical architecture reference for both AwardLens
projects. The companion drawio file at [`diagram.drawio`](./diagram.drawio)
contains two pages — **Runtime Architecture** and **Models Pipeline** —
that visualize the structures described here. Open it with
[diagrams.net](https://app.diagrams.net) or the *Draw.io Integration* VS
Code extension.

---

## 1. Executive Summary

AwardLens is a federal-procurement intelligence platform that turns the
public USAspending / SAM / Grants feeds into a curated, queryable
warehouse with a natural-language interface. The product surfaces a React
dashboard, a Cloudflare Worker API, and a three-tier AI router that
combines two custom-fine-tuned small language models (SLMs) with
Anthropic's Claude as a generalist fallback.

The system is deployed entirely on free or zero-fixed-cost tiers:

- **Cloudflare Free** for Pages, Worker, D1, KV, Vectorize, and Workers AI.
- **Oracle Always-Free** for the ingestion sidecar (1 vCPU / 6 GB ARM VM).
- **Modal Serverless** for GPU inference, billed per-second-of-runtime
  with scale-to-zero.
- **Anthropic API**, **HuggingFace**, **RunPod** as pay-as-you-go.

The split between the two repositories is deliberate: `award-lens` is a
TypeScript stack (worker + SPA + migrations), while `award-lens-models`
is a Python / ML stack (training scripts + Modal worker code). They share
a stable HTTP contract — Modal exposes one endpoint, the Worker calls
it — so each side iterates independently.

---

## 2. `award-lens` — Runtime Architecture

### 2.1 Frontend (Cloudflare Pages)

| | |
|--|--|
| **Stack** | React 18 · Vite · TypeScript · Tailwind · framer-motion · Radix UI |
| **Bundle** | served from `awards-dashboard.pages.dev` |
| **Auth** | Google OAuth via Pages Functions (cookie-based session) |
| **Routing** | hash-based router (`useHashRoute`) |
| **State** | `AgencyContext` (top-bar scope), `AiAwardContext` (focused award), `AppShell` sidebar collapse |

The SPA is a pure static-asset deployment — no server-side rendering. It
ships five Analytics views: **Clusters** (force-directed bubble chart),
**Timeline** (variable-height pill Gantt), **Tree** (D3 spend hierarchy),
**Summary** (sortable list), and **Pivot Table** (react-pivottable).
A `ConversationalIntelligenceWidget` renders as a right-edge 25vw rail
that sends questions to the AI router and displays results inline.

### 2.2 Edge proxy (Pages Functions)

`web/functions/_middleware.ts` runs on every request to
`awards-dashboard.pages.dev` and forwards `/auth/*`, `/api/*`, and `/ai/*`
prefixes to the Cloudflare Worker. This makes the session cookie
*first-party* (the SPA and the Worker share the same origin), which is
required because modern browsers (Edge tracking prevention, Safari ITP,
Chrome 3rd-party blocking) silently drop cross-site cookies.

### 2.3 API tier — Cloudflare Worker (Hono)

`api-worker.algocrat.workers.dev` is a single Worker bound to D1, KV,
Vectorize, and Workers AI. Hono provides routing; auth is checked per
route. The worker is logically partitioned into three modules:

- **Auth** (`src/auth/`) — Google OAuth handshake, KV-backed sessions,
  role enforcement (`admin` / `user` / `rejected` after the
  `0021_auto_approve_pending` migration retired the pending gate).
- **Data API** (`src/index.ts`) — `/explore`, `/awards/:id`,
  `/agencies-with-counts`, `/import/awards`, etc. Every read goes through
  `resolveScope()` which produces a `ViewScope`, `FilterScope`,
  `'unscoped'` (admin), or `'agency'` (non-admin via top-bar picker) and
  `composeAwardQuery()` translates that into safe parameterized SQL.
- **AI router** (`src/ai/router.ts`) — see §2.5.

### 2.4 Data tier

| Store | Binding | Contents |
|--|--|--|
| **D1** | `DB` (`awards-warehouse`) | Award + vendor + organization + NAICS/PSC + solicitation + sam_exclusion + ai_audit + ai_inaccuracy_report + app_user (~50K awards, ~25K vendors) |
| **KV** | `META` | OAuth state nonces, session tokens, hot config |
| **Vectorize** | `VEC` (`awardlens-awards`) | 768-dim BGE embeddings, one vector per indexed award, cosine ANN |
| **R2** | (reserved) | future SOW PDF cache |

Migrations live under `packages/migrations/` and are applied via
`npx wrangler d1 migrations apply awards-warehouse --remote`. The most
recent migrations:

- `0018_ai_audit.sql` — one row per AI model call (no raw text stored,
  only `question_hash`).
- `0019_ai_audit_similar.sql` — adds `'reasoning_local'` / `'similar_awards'`
  to the intent enum.
- `0020_ai_inaccuracy_report.sql` — user-submitted reports of bad AI
  answers, linked back to `ai_audit` via `audit_id`.
- `0021_auto_approve_pending.sql` — bulk-flips pending users to `user`,
  retiring the admin-approval gate.

### 2.5 AI tier — three-model routing

The `/ai/v2/ask` endpoint accepts a `{ query, context?, scope? }` payload
and classifies intent before dispatching to one of three models. The
classifier (`classifyIntent` in `router.ts`) is regex-based and tiered
so that *interpret-this* questions about a focused award outrank both
the warehouse-SQL path and the generalist path:

```
GENERAL_OVERRIDE (FAR / DFARS / SAT thresholds, etc.)        → general (M3)
SIMILAR_PATTERNS (with award context) "find similar to this" → similar_awards
ABOUT_THIS_PATTERNS (with award context) "what is this"      → general (M3 + context)
SQL_SIGNAL_PATTERNS (domain noun / aggregation / lifecycle)  → sql_query (M1)
otherwise                                                    → general (M3)
```

| Intent | Model | Path |
|--|--|--|
| `sql_query` | **M1** (Modal · `awards-sql-lora`) | M1 generates SQL → executed against D1 → **M2** summarizes the rows → returned as `{ sql, cols, rows, summary }` |
| `similar_awards` | none | embed `description + NAICS + PSC + PSC desc` via Workers AI BGE → Vectorize ANN → fetch top-K rows from D1 (agency-scoped if a picker is active) → return as a clickable table under a fixed `Contracts with similar nature of work:` header |
| `general` | **M3** (Anthropic `claude-sonnet-4-5`) | optional `FOCUSED AWARD` block (description + NAICS + PSC public fields) prepended to the user message, no internal data, falls back to Workers AI Llama 3.1 8B if the Anthropic call errors |

All three paths write a row to `ai_audit` for cost / quality observability.
Each assistant message in the chat exposes a *Report inaccuracy* control
that POSTs to `/ai/report-inaccuracy`, capturing the question, response,
context, and user-supplied "what's wrong / what was expected / examples"
into `ai_inaccuracy_report` linked by `audit_id`.

### 2.6 Authentication & access control

- **Sign-in**: Google OAuth via `/auth/google/start` → `/auth/google/callback`.
  First-time users land as `role='user'` with `approved_at=now()`.
  The configured `ADMIN_BOOTSTRAP_EMAIL` lands as `role='admin'`.
- **Session**: signed cookie referencing a KV-stored session record.
- **Authorization**: route-level checks in the SPA (`App.tsx` route guard)
  and per-endpoint checks in the Worker (`requireUser`, `requireAdmin`).
  The sidebar hides admin sections from regular users; admin endpoints
  return 403 if hit by URL.
- **Data scoping**: `/explore` and `/awards/:id` read through
  `resolveScope()`. Admins can browse the full warehouse; non-admins
  must pass `view_id`, `filter_id`, or — since the
  `agency` scope kind was added — an `awarding_agency` from the top-bar
  picker.
- **Privacy**: M3 only ever sees four public fields from any award
  (`description`, `naics_code`, `psc_code`, `psc_description`). All
  internal-classified columns (vendor scoring, mod history, audit notes)
  stay inside the worker boundary.

### 2.7 Ingestion — Oracle Always-Free sidecar

A 1 vCPU / 6 GB ARM VM (`awards-sidecar`) runs `ingest-pipeline` on cron.
Each run pulls deltas from USAspending, SAM, and Grants.gov, normalizes
them into the warehouse schema, and POSTs to
`/import/awards` with an `INGEST_TOKEN` bearer header. The Worker handles
upserts into `award`, `vendor`, `organization`, `award_federal_account`,
and the related dimension tables. Periodically the sidecar also triggers
`POST /ai/reindex-awards`, which rebuilds the Vectorize index from the
current warehouse contents (chunked into batches of N rows; embed via
Workers AI BGE; upsert into `awardlens-awards`).

The runbook for provisioning a fresh sidecar lives in
[`docs/runbooks/new-sidecar-vm.md`](../runbooks/new-sidecar-vm.md).

---

## 3. `award-lens-models` — Models Pipeline

The models repo packages everything needed to (re)train and (re)deploy
M1 and M2. It speaks no D1, no Cloudflare — the only contract with the
rest of the system is the Modal HTTPS endpoint shape.

### 3.1 Training data preparation

Synthetic data is bootstrapped from a small set of hand-written
question / SQL pairs, then expanded through two LLMs:

- `02_paraphrase_claude.py` — Anthropic Sonnet rewrites each seed
  question in 5–10 different styles ("how many", "show me",
  "give me a list of"), keeping the gold SQL constant.
- `02c_generate_novel_claude.py` — Sonnet invents *new* question
  variants targeted at under-represented schema regions (federal
  accounts, mod history, exclusion checks).
- `03_generate_qwen.py` — Qwen via Workers AI generates additional
  diverse phrasings cheaply.
- `build_compact_schema.py` — extracts the live D1 schema and emits a
  token-efficient system prompt that M1 sees at inference time.
- `04_combine.py` + `01_split_eval.py` — combine, dedupe, train/eval split.

Output: `finetuned_v2.jsonl` (M1) and `m2_training.jsonl` (M2).

### 3.2 LoRA fine-tuning on RunPod

`runpod_train.py` runs on a single RunPod A100 80GB. Stack:

- HuggingFace `transformers`, `trl`, `peft`, `bitsandbytes`.
- 4-bit base load (`BitsAndBytesConfig`).
- LoRA rank 16 / α 32 / dropout 0.05, targets `q_proj,k_proj,v_proj,o_proj`.
- Cosine learning-rate schedule, ~2–3 hours per adapter.

`07_eval_finetuned.py` evaluates the trained adapter against a held-out
set: exact-match SQL accuracy for M1, ROUGE-L for M2 summaries, plus
regression checks against the previous version.

### 3.3 Adapter registry — HuggingFace

Adapters are uploaded to HuggingFace via `huggingface_hub`. Two public
repos serve as the registry:

- [`algocrat/awards-sql-lora`](https://huggingface.co/algocrat/awards-sql-lora)
- [`algocrat/awards-summarize-lora`](https://huggingface.co/algocrat/awards-summarize-lora)

Only the LoRA weights are uploaded — typically ~50 MB per adapter,
versioned by commit SHA. The base Llama 3.1 8B Instruct weights are
public and pulled separately by Modal at image-build time.

### 3.4 Production serving — Modal Serverless

`modal-worker/` builds a container image that bakes the base model and
both LoRA adapters at image-build time. This avoids cold-start adapter
downloads — the first request after a scale-to-zero pause incurs only
GPU warmup (~10 s), not network I/O.

Runtime:

- **App**: `awards-slm-v2`
- **GPU**: A10G
- **Scaledown window**: 300 s
- **Endpoint**: `https://algocrat--awards-slm-v2-model-infer.modal.run`
- **Auth**: `api_key` field in the JSON body (not a header — Modal's
  default auth model)
- **Adapter selection**: `{ "adapter": "m1" | "m2" }` in the request,
  switching the active LoRA via PEFT's adapter API

The `award-lens` Worker calls this endpoint from `m1_sql.ts` and
`m2_local.ts` with a 25-second timeout and a Workers AI Llama 3.1 8B
fallback for cold-start or transient-failure cases.

---

## 4. End-to-end Data Flows

### 4.1 "How many awards does NASA have in 2025?" (SQL path)

```
Browser → POST /ai/v2/ask {"query": "..."}
  → Pages Functions → Worker
  → classifyIntent() → 'sql_query' (matches "award" + verb prefix)
  → callM1() → Modal /infer { adapter: 'm1', messages: [...] } → SQL
  → executeSQL(D1) → { cols, rows }
  → callM2() → Modal /infer { adapter: 'm2', messages: [question + rows] } → summary
  → audit row inserted in ai_audit
  → response: { intent: 'sql_query', sql, cols, rows, summary, audit_ids }
```

### 4.2 "Find me similar contracts" (with an award open)

```
Browser → POST /ai/v2/ask {"query": "...", "context": {...}, "scope": {...}}
  → classifyIntent() → 'similar_awards' (SIMILAR_PATTERNS match + context present)
  → embed text = description + NAICS + PSC + PSC desc
  → Workers AI BGE → 768-dim vector
  → Vectorize.query (topK=99 if agency-scoped, 10 otherwise)
  → SQL fetch: filter to user's agency, ORDER BY pop_end_date, LIMIT 10
  → response: { intent: 'similar_awards', cols, rows, summary: 'Contracts with similar nature of work:' }
  → SPA renders a clickable table under that header
  → click row → setSelectedAward + GET /awards/:id → AwardDetail panel populates with full record
```

### 4.3 "What is this contract about?" (M3 with context)

```
Browser → POST /ai/v2/ask {"query": "...", "context": {...}}
  → classifyIntent() → 'general' (ABOUT_THIS_PATTERNS match + context present)
  → callM3(question, anthropicKey, awardContext)
    → user message = "FOCUSED AWARD:\n{description, naics, psc, psc_desc}\n\nQuestion: ..."
  → Anthropic claude-sonnet-4-5
  → response: { intent: 'general', answer }
```

### 4.4 Inaccuracy report

```
Hover an assistant message → Click "Report inaccuracy"
  → form: description, expected outcome, examples
  → POST /ai/report-inaccuracy with audit_id from response.audit_ids
  → row inserted into ai_inaccuracy_report
  → toast confirms; admin queries by status='open' for triage
```

---

## 5. Privacy & Data Classification

| Class | Examples | May reach M3? |
|--|--|--|
| **PUBLIC** | Description, NAICS / PSC codes & descriptions, agency name, award value | Yes (USAspending public) |
| **INTERNAL** | Vendor exclusion flags, internal notes, mod history details, scoring | Never |
| **SECRET** | API keys, OAuth client secret, INGEST_TOKEN | Worker secrets only, never logged |

The M3 system prompt is explicit: it may discuss the FOCUSED AWARD block
freely (those fields are USAspending-public) and must defer to the data
API for anything else. M1 and M2 only ever see warehouse data inside the
Worker → Modal channel, never leaving the Capture Intelligence
infrastructure boundary. Every model call is audited regardless of class.

---

## 6. Deployment Topology

| Component | Region / Tier | Cost model |
|--|--|--|
| Cloudflare Pages | Global edge | Free |
| Cloudflare Worker | Global edge | Free (within 100K req/day) |
| Cloudflare D1 | Auto-replicated | Free (within row & I/O limits) |
| Cloudflare KV | Global edge | Free |
| Cloudflare Vectorize | One region | Free (within 5M vectors / 30M queries / month) |
| Workers AI | Edge inference | Free tier (10K requests/day) |
| Oracle VM | `awards-sidecar` (us-ashburn-1, A1.Flex 1c/6G) | Always Free |
| Modal Serverless | Per region · A10G | Per-second GPU (~$0.0006 / s warm; scale-to-zero) |
| Anthropic API | api.anthropic.com | Per-token (M3 inference only) |
| HuggingFace | Public model registry | Free for public adapters |
| RunPod | A100 80GB pod, hourly | Pay-as-you-go (~$2/hr · ~$5–10 per training run) |

The product runs in steady state at near-zero fixed cost. The marginal
cost per AI question is dominated by Modal's GPU seconds (cold start +
inference) and Anthropic tokens for the M3 path.

---

## 7. Observability & Auditing

- `ai_audit` — every model call: user, hashed question, intent, model id,
  prompt / output tokens, duration, success / error, data_class.
- `ai_inaccuracy_report` — user-flagged bad answers, linked to the audit
  row by `audit_id`. Admin pulls open reports for triage and feeds the
  training pipeline.
- `app_user_audit` — every role change (created, approved, rejected,
  role_changed) with from/to/notes. The `0021_auto_approve_pending`
  migration writes one row per user it sweeps so the trail explains
  why pending → user happened.
- Cloudflare Worker logs — short retention; enable Logpush to R2 / S3
  if a longer trail is needed.

---

## 8. Repository Layout

```
award-lens/                               (this repo)
├── web/                                  React SPA + Pages Functions
│   ├── src/
│   │   ├── pages/Analytics.tsx           5-tab analytics view
│   │   ├── components/viz/               Clusters, Timeline, Tree, …
│   │   ├── components/ConversationalIntelligenceWidget.tsx
│   │   ├── components/AwardDetail.tsx    left-side detail rail
│   │   ├── lib/agency-context.tsx
│   │   ├── lib/ai-award-context.tsx      shared selected-award state
│   │   └── lib/nature-palette.ts         single source of viz colors
│   └── functions/_middleware.ts          first-party proxy
├── workers/api/                          Cloudflare Worker (Hono)
│   ├── src/index.ts
│   ├── src/auth/                         OAuth + sessions
│   ├── src/views/scope.ts                resolveScope + composeAwardQuery
│   └── src/ai/                           router, m1_sql, m2_local, m3_external,
│                                         report, audit, types, reindex
├── packages/migrations/                  D1 SQL migrations
├── sidecar-oracle/                       Oracle VM bootstrap & ingest-pipeline
├── scripts/                              local helpers (OCI launch, vectorize)
└── docs/
    ├── architecture/
    │   ├── OVERVIEW.md                   (this file)
    │   ├── diagram.drawio                runtime + models pipeline
    │   └── MODEL-ROUTING.md              detailed model-routing spec
    └── runbooks/

award-lens-models/                        (sibling repo)
├── slm/scripts/                          training pipeline
│   ├── 01_split_eval.py
│   ├── 02_paraphrase_claude.py
│   ├── 02c_generate_novel_claude.py
│   ├── 03_generate_qwen.py
│   ├── 04_combine.py
│   ├── 05*_baseline_*.py                 baseline models (sqlcoder etc.)
│   ├── 06_train.py · runpod_train.py
│   └── 07_eval_finetuned.py
├── slm/data/                             training jsonl
├── slm/runpod-worker/                    RunPod orchestration
└── slm/modal-worker/                     Modal image + handler
    └── modal_handler.py                  /infer endpoint
```

---

## 9. Operational Cheat-Sheet

| Action | Command (run from repo root) |
|--|--|
| Deploy Worker | `cd workers/api && npx wrangler deploy` |
| Deploy SPA to production | `cd web && pnpm run build && npx wrangler pages deploy dist --project-name awards-dashboard --branch production` |
| Apply D1 migration | `cd workers/api && npx wrangler@latest d1 migrations apply awards-warehouse --remote` |
| Reindex Vectorize | `curl -X POST https://api-worker.algocrat.workers.dev/ai/reindex-awards -H "Authorization: Bearer $INGEST_TOKEN"` |
| View open inaccuracy reports | `wrangler d1 execute awards-warehouse --remote --command "SELECT report_id, ts, intent, question, inaccuracy_description FROM ai_inaccuracy_report WHERE status='open' ORDER BY ts DESC LIMIT 50"` |
| Train M1 (in models repo) | `python slm/scripts/runpod_train.py --adapter m1 --base meta-llama/Llama-3.1-8B-Instruct` |
| Deploy Modal worker (in models repo) | `cd slm/modal-worker && modal deploy modal_handler.py` |

---

## 10. Roadmap & Known Gaps

- **R2 SOW cache** — phased in; currently skipped to stay on free tier.
- **Center scoping for non-admins** — currently agency-only; center
  filtering goes through `cdc_center` mapping and isn't yet plumbed
  through `composeAwardQuery`.
- **Workers AI native LoRA hosting** — blocked on adapter format
  compatibility (`09_upload_workers_ai.md` tracks status). Modal serves
  M1 / M2 in the meantime.
- **Eval harness automation** — `07_eval_finetuned.py` runs by hand
  today; no CI pipeline yet to gate adapter releases.
- **Admin UI for inaccuracy report triage** — table exists, query is
  documented above, but no in-app dashboard for marking
  `reviewed` / `resolved` yet.

---

*Last updated: see commit history.*
