#!/usr/bin/env bash
# Wait for the running Qwen generation process to exit, then chain:
#   04_combine.py → 05_baseline.py → 06_train.py → 07_eval_finetuned.py
#
# Each step logs to data/chain.log and writes its own artifacts. If a step
# fails the chain stops and the failure is recorded; later steps don't run.
#
# Run with:
#   nohup bash scripts/run_after_qwen.sh > data/chain.stdout 2>&1 &
#
# Resumable: re-running it skips already-completed steps (presence of
# expected output files signals completion).

set -u
cd "$(dirname "$0")/.."
ROOT="$(pwd)"
LOG="$ROOT/data/chain.log"

. .venv/bin/activate
set -a; . .env; set +a

stamp() { date -u +%Y-%m-%dT%H:%M:%SZ; }
log() { printf '[%s] %s\n' "$(stamp)" "$*" | tee -a "$LOG"; }

log "=== chain runner start ==="

# ─── Step 0: wait for Qwen ────────────────────────────────────────────────
QWEN_PID=$(pgrep -f 'scripts/03_generate_qwen.py' | head -1)
if [ -n "$QWEN_PID" ]; then
  log "Waiting for Qwen process PID=$QWEN_PID to exit..."
  while kill -0 "$QWEN_PID" 2>/dev/null; do sleep 30; done
  log "Qwen process exited."
else
  log "No Qwen process running — proceeding."
fi

# Sanity: was Qwen output produced?
if [ ! -s "$ROOT/data/generated.jsonl" ]; then
  log "WARN: data/generated.jsonl is empty — Qwen may have crashed. Continuing with seed+paraphrase only."
fi

# Wait a few seconds so GPU memory is fully released
sleep 10
log "GPU snapshot before next step:"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | tee -a "$LOG"

# ─── Step 1: combine ──────────────────────────────────────────────────────
if [ -s "$ROOT/data/train.jsonl" ] && [ -s "$ROOT/data/val.jsonl" ]; then
  log "SKIP combine — train.jsonl + val.jsonl already exist."
else
  log "STEP combine: running 04_combine.py"
  if python3 scripts/04_combine.py 2>&1 | tee -a "$LOG"; then
    log "combine OK"
  else
    log "combine FAILED — stopping chain."
    exit 2
  fi
fi

# ─── Step 2: baseline ─────────────────────────────────────────────────────
if [ -s "$ROOT/data/baseline_summary.txt" ]; then
  log "SKIP baseline — baseline_summary.txt already exists."
else
  log "STEP baseline: running 05_baseline.py (loads Llama 3.1 8B; first run downloads ~16 GB)"
  if python3 scripts/05_baseline.py 2>&1 | tee -a "$LOG"; then
    log "baseline OK"
  else
    log "baseline FAILED — stopping chain."
    exit 3
  fi
fi

# Free GPU memory by ensuring the python process exited (running as a fresh
# subprocess in next step does that anyway, but be explicit).
sleep 5
log "GPU snapshot before train:"
nvidia-smi --query-gpu=memory.used,memory.total --format=csv,noheader | tee -a "$LOG"

# ─── Step 3: train ────────────────────────────────────────────────────────
if [ -s "$ROOT/out/llama31-8b-awards-sql/adapter_model.safetensors" ]; then
  log "SKIP train — adapter already exists at out/llama31-8b-awards-sql/."
else
  log "STEP train: running 06_train.py (~2-4 hrs on RTX 3060)"
  if python3 scripts/06_train.py 2>&1 | tee -a "$LOG"; then
    log "train OK"
  else
    log "train FAILED — stopping chain."
    exit 4
  fi
fi

# ─── Step 4: eval fine-tuned ──────────────────────────────────────────────
if [ -s "$ROOT/data/finetuned_summary.txt" ]; then
  log "SKIP eval — finetuned_summary.txt already exists."
else
  log "STEP eval: running 07_eval_finetuned.py"
  if python3 scripts/07_eval_finetuned.py 2>&1 | tee -a "$LOG"; then
    log "eval OK"
  else
    log "eval FAILED — but adapter was trained; manual inspection recommended."
    exit 5
  fi
fi

log "=== chain runner complete ==="
echo "" | tee -a "$LOG"
echo "===== FINAL SUMMARIES =====" | tee -a "$LOG"
echo "" | tee -a "$LOG"
[ -f data/combine_report.txt ] && cat data/combine_report.txt | tee -a "$LOG"
echo "" | tee -a "$LOG"
[ -f data/finetuned_summary.txt ] && cat data/finetuned_summary.txt | tee -a "$LOG"
