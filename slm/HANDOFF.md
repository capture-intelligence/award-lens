# SLM Project Handoff — Resume from this state

**As of:** 2026-05-02 ~7:50 PM EDT
**Original session:** Linux desktop (algocrat-Precision-Tower-3620)
**Resuming on:** Windows laptop (or fresh machine)

---

## Where we stand

A federal-awards text-to-SQL fine-tuning project. We're between
training rounds. Round 1 (Llama-3.1-8B + LoRA, 1,020 pairs) hit only 15%
exec accuracy due to overfitting + small data. Round 2 setup is ready
with 3,887 validated training pairs and Configuration D as the deploy
architecture.

### What's done

- ✅ **Dataset combined**: 3,887 unique `(question, sql)` pairs
  (`data/train.jsonl` 3514 + `data/val.jsonl` 373)
- ✅ **Held-out eval**: 20 stratified questions in `data/eval.jsonl`
- ✅ **Compact schema** for prompts: `data/schema_compact.txt` (~1,475 tok)
- ✅ **Local DB**: `data/awards-warehouse.db` (14 MB, full warehouse copy
  for SQL validation)
- ✅ **v1 adapter** (Llama-3.1-8B, the failed 15%-accuracy run): `out/llama31-8b-awards-sql/`
- ✅ **Architecture spec**: `docs/architecture/MODEL-ROUTING.md`
- ✅ **Baseline scores measured**: see `data/baseline*.txt`
  - Llama-3.1-8B (Workers AI, 5-shot): **25%**
  - Qwen2.5-7B-Turbo (Together, 5-shot): 20%
  - SQLCoder-7B-2 (Workers AI, 5-shot): 15%
  - Llama-3.1-8B + LoRA v1 (RunPod, 0-shot): 15%

### What's NOT done

- ❌ M2 (Local Reasoner) training data — needs ~$5 in Claude API to generate
- ❌ Llama-3.1-8B + LoRA v2 (M1) training — pending RunPod kickoff
- ❌ Llama-3.1-8B + LoRA v2 (M2) training — pending M2 data gen
- ❌ Eval of v2 LoRAs
- ❌ Fireworks AI account + deploy
- ❌ RAG corpus + Vectorize index
- ❌ Router implementation in api-worker
- ❌ End-to-end test through `/ai/ask`

### Architecture decisions locked in

**Configuration D** — separate M1 and M2, both fine-tuned, hosted on Fireworks AI.

| Role | Where | Model | Cost @ 100q/mo |
|---|---|---|---|
| **M1 (SQL)** | Fireworks AI serverless | Llama-3.1-8B + `awards-sql-lora` | ~$0.03 |
| **M2 (Local Reasoner + RAG)** | Fireworks AI serverless | Llama-3.1-8B + `awards-summarize-lora` | ~$0.04 |
| RAG embeddings | Workers AI free | `@cf/baai/bge-base-en-v1.5` | $0 |
| RAG store | Cloudflare Vectorize free tier | (after token unblock) | $0 |
| **M3 (External)** | Anthropic API | `claude-sonnet-4-5` | ~$0.40 |
| **Total estimate** | | | **~$0.50/mo** |

Hard rules from the spec (`docs/architecture/MODEL-ROUTING.md`):
- M1, M2 receive private data freely; M3 also (per your "if user can see it,
  Anthropic can see it" decision — no PII scrubber needed).
- Only RESTRICTED data (sessions, auth tokens, audit log internals) never
  reaches any LLM.
- All users authorized for all SQL data in v1 (no view-access wrapping).
- Single-tier policy in v1 (no per-view classification).

### RunPod state

- Pod ID: `ojzoasdsolw064` (name: `awards-sql-train`)
- Status: **EXITED** (stopped, volume preserved, no billing)
- SSH key: `~/.ssh/runpod_ed25519` (Linux home; if not present on Windows,
  generate a new one and inject via `PUBLIC_KEY` env on next pod launch)
- v1 adapter on pod's `/workspace/slm/out/llama31-8b-awards-sql/` (also
  copied locally to `slm/out/llama31-8b-awards-sql/`)

### Anthropic credit

~$19.40 remaining. Plenty for M2 data generation (~$5–10).

---

## How to resume

### Step 1 — Set up Windows machine

1. Install **Python 3.11 or 3.12** from python.org
2. Install **Git**
3. (For RunPod orchestration) Install **OpenSSH** — comes with Windows 10/11 by default
4. Unpack this zip somewhere stable (e.g. `C:\Users\You\awards-slm\`)
5. From a PowerShell or cmd inside that folder:
   ```cmd
   python -m venv .venv
   .venv\Scripts\activate
   pip install -r requirements.txt
   ```

### Step 2 — Restore SSH key for RunPod

```cmd
:: Make ~/.ssh on Windows
mkdir %USERPROFILE%\.ssh

:: Copy the key files (private + public) from this zip's `ssh/` folder
copy ssh\runpod_ed25519       %USERPROFILE%\.ssh\runpod_ed25519
copy ssh\runpod_ed25519.pub   %USERPROFILE%\.ssh\runpod_ed25519.pub

:: Lock down perms (PowerShell)
icacls %USERPROFILE%\.ssh\runpod_ed25519 /inheritance:r /grant:r "%USERNAME%:R"
```

### Step 3 — Verify environment

```cmd
.venv\Scripts\activate
python -c "from anthropic import Anthropic; import os, runpod; runpod.api_key = os.environ['RUNPOD_API_KEY']; print('anthropic ok'); print('runpod pods:', len(runpod.get_pods()))"
```

If that prints "anthropic ok" and a pod count, you're good.

### Step 4 — Start a fresh Claude Code session

Open a terminal in the unpacked folder and run:
```cmd
claude
```

(Install Claude Code first if you haven't: https://claude.com/code)

### Step 5 — Paste this prompt to resume

Copy-paste the block at the bottom of this file (`RESUME PROMPT`)
into the Claude Code session. It contains the full context Claude needs
to pick up where we left off.

---

## Files in this zip

```
.
├── HANDOFF.md                          ← you are here
├── README_PROJECT.md                   ← copy of the project's main README for context
├── requirements.txt                    ← Python deps
├── .env                                ← all API keys (rotate after migration!)
├── data/
│   ├── seed.jsonl                      ← 112 hand-written pairs (held-back for eval shots)
│   ├── paraphrased.jsonl               ← 896 Claude paraphrases of seeds
│   ├── generated.jsonl                 ← 30 from old Qwen-on-3060 attempt
│   ├── generated_claude.jsonl          ← 2,867 NEW Claude-generated pairs (the bulk)
│   ├── train.jsonl                     ← 3,514 — combined dataset for training
│   ├── val.jsonl                       ← 373 — combined val split
│   ├── eval.jsonl                      ← 20 held-out questions for eval
│   ├── schema_compact.txt              ← compressed schema for prompts (~1,475 tok)
│   ├── schema_prompt.txt               ← full schema (legacy, larger)
│   ├── awards-warehouse.db             ← local SQLite copy (14 MB) for SQL validation
│   ├── baseline.jsonl + .txt           ← Workers AI Llama 5-shot baseline (25%)
│   ├── baseline_sqlcoder.jsonl + .txt  ← Workers AI SQLCoder 5-shot baseline (15%)
│   ├── baseline_together_*.jsonl       ← Together AI Qwen baselines
│   ├── finetuned*.jsonl                ← v1 LoRA eval results (15%)
│   └── combine_report.txt              ← dataset breakdown
├── scripts/
│   ├── 01_split_eval.py
│   ├── 02_paraphrase_claude.py         ← already ran ($1.50)
│   ├── 02c_generate_novel_claude.py    ← already ran ($5–6)
│   ├── 03_generate_qwen.py             ← deprecated (Qwen-on-3060 hung)
│   ├── 04_combine.py                   ← already ran (combine done)
│   ├── 05_baseline.py                  ← old local baseline
│   ├── 05b_baseline_workers_ai.py      ← Workers AI Llama baseline
│   ├── 05c_baseline_together.py        ← Together AI baseline
│   ├── 05d_baseline_sqlcoder.py        ← Workers AI SQLCoder baseline
│   ├── 06_train.py                     ← v2 train config — UPDATE for Llama-3.1-8B + Fireworks/WAI-compat (r=16, q/k/v/o) BEFORE running
│   ├── 07_eval_finetuned.py            ← post-train eval (uses 5-shot now)
│   ├── 08_serve_local.py               ← FastAPI local serving (legacy from 3060 era)
│   ├── 09_upload_workers_ai.md         ← deploy steps (LIMITED — Llama 3.1 not BYO-LoRA-eligible per probe)
│   ├── runpod_train.py                 ← RunPod orchestrator (create/resume/scp/run/teardown)
│   ├── build_compact_schema.py
│   └── build_training_pairs.py
├── out/
│   └── llama31-8b-awards-sql/          ← v1 LoRA adapter (failed run, 15% — kept for reference)
├── ssh/
│   ├── runpod_ed25519                  ← SSH private key for RunPod pod
│   └── runpod_ed25519.pub
└── docs/
    └── architecture/
        └── MODEL-ROUTING.md            ← THE architecture spec
```

---

## Security note

**Every API key in `.env` was pasted into chat history at some point during
development.** Rotate them at first opportunity:

- HuggingFace: https://huggingface.co/settings/tokens (revoke `llama-finetune`, create new)
- Anthropic: https://console.anthropic.com/settings/keys (revoke `slm-synth`, create new)
- RunPod: https://www.runpod.io/console/user/settings (revoke `capture-models`, create new)
- Together AI: https://api.together.ai/settings/api-keys
- Cloudflare: not needed unless using API token (we used wrangler OAuth which auto-rotates)
- The sudo password from earlier (`Nasik+11`) — change it on the Linux box

---

# RESUME PROMPT — paste this into the new Claude Code session

```
I'm resuming the awards-sql LoRA fine-tuning project from a saved state.
Read `HANDOFF.md` in the project root for full context. TL;DR:

WHERE WE LEFT OFF
- Dataset of 3,887 unique (question, SQL) pairs ready in data/train.jsonl
  + data/val.jsonl. Held-out eval set in data/eval.jsonl.
- Configuration D locked in: Llama-3.1-8B + LoRA × 2 (separate M1 & M2),
  hosted on Fireworks AI. Architecture in docs/architecture/MODEL-ROUTING.md.
- v1 LoRA exists (out/llama31-8b-awards-sql/) but only hit 15% — failed.
- All API keys in .env (rotate after first successful migration test).
- RunPod pod ojzoasdsolw064 is stopped, volume preserved.
- Baseline to beat: 25% (Llama 5-shot prompted on Workers AI).

NEXT STEPS (Phase 1 — Tonight)
1. Update scripts/06_train.py to use:
   - BASE_MODEL = 'meta-llama/Llama-3.1-8B-Instruct'
   - LoRA r=16, alpha=32, target_modules=['q_proj','k_proj','v_proj','o_proj']
     (Fireworks-AI compatible config)
   - num_train_epochs=1, learning_rate=1e-4
   - eval_strategy='steps', eval_steps=50, early_stopping patience=3
2. Write scripts/02d_generate_summaries_claude.py that:
   - Takes 500–1000 (question, sql) pairs from train.jsonl
   - Executes each SQL against data/awards-warehouse.db
   - Asks Claude to write a natural-language summary of the results
   - Outputs (question, sql_results, summary) triples to
     data/m2_training.jsonl
   - Cost: ~$5–10 in Anthropic API
3. Run 02d to build M2 training data
4. Restart RunPod pod via scripts/runpod_train.py --resume ojzoasdsolw064
5. Train M1 LoRA (existing 06_train.py, train.jsonl) — ~50 min on RTX 4090
6. Train M2 LoRA (modified 06_train.py with new dataset format) — ~50 min
7. Eval both via 07_eval_finetuned.py
8. Stop pod
9. Decide ship/iterate based on numbers

CONSTRAINTS / FACTS LEARNED
- Workers AI BYO-LoRA only supports Llama-2-7B, Gemma-2B/7B, Mistral-7B-v0.2
  (NOT Llama-3.1) — that's why Fireworks AI is the host for our LoRA.
- Together AI hosts Qwen-Coder-7B only as paid dedicated endpoint.
- SQLCoder-7B-2 hosted on Workers AI but performs poorly on our SQLite (15%);
  it's PostgreSQL-trained.
- gradient_checkpointing=False causes OOM on 4090; True works on datacenter
  GPUs (the deadlock happened only on the consumer 3060).
- The local 3060 driver locks any time a CUDA process is killed; we
  abandoned local training entirely.
- Combine script's re-validation step hangs on at least one query — disabled
  in the current 04_combine.py. Trust upstream validation.

USER PREFERENCES
- Wants chat-fast UX (<2s) → no OCI ARM, no RunPod cold starts
- All users authorized for all SQL data (no view scoping in v1)
- No PII scrubber for v1 (Anthropic gets same data as users)
- Separate M1 and M2 (don't combine into one LoRA)
- M2 also fine-tuned + RAG (not just prompted)
- Skip multi-tenancy for v1

Begin Phase 1.
```
