"""
Baseline using a Together AI hosted model — no fine-tuning, just prompted
inference with schema + 5-shot examples.

If a strong SQL-specialized model (Qwen3-Coder-30B) hits ≥60% on our 20
eval questions out of the box, fine-tuning is not necessary at this scale.

Usage:
  TOGETHER_API_KEY=tgp_... python3 scripts/05c_baseline_together.py \
       [--model Qwen/Qwen3-Coder-30B-A3B-Instruct]
       [--shots 5]

Output: data/baseline_together_<modelslug>.{jsonl,txt}
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval.jsonl"
SEED = ROOT / "data" / "seed.jsonl"
SCHEMA = ROOT / "data" / "schema_compact.txt"
DB = ROOT / "data" / "awards-warehouse.db"

SYSTEM = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query that answers it.
Do not include explanation, markdown fences, or commentary — just the SQL ending with a semicolon."""

def normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", sql.strip().rstrip(";").lower())

def rows_eq(a, b) -> bool:
    return sorted(map(repr, a)) == sorted(map(repr, b))

def extract_sql(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m: text = m.group(1)
    m = re.match(r"\s*(.*?;)", text, re.DOTALL)
    if m: text = m.group(1)
    return text.strip()

def call_together(token: str, model: str, messages: list[dict], retries: int = 5) -> str:
    body = json.dumps({"model": model, "messages": messages, "max_tokens": 400, "temperature": 0.0}).encode()
    last_err = None
    for attempt in range(retries):
        req = urllib.request.Request(
            "https://api.together.xyz/v1/chat/completions",
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Content-Type": "application/json",
                # Cloudflare WAF blocks Python's default UA with error 1010
                "User-Agent": "awards-sql-eval/1.0 (curl-compatible)",
            },
            method="POST",
        )
        try:
            with urllib.request.urlopen(req, timeout=120) as r:
                data = json.loads(r.read())
            if "choices" not in data:
                raise RuntimeError(f"Together error: {data.get('error', data)}")
            return data["choices"][0]["message"]["content"]
        except urllib.error.HTTPError as e:
            last_err = e
            if e.code in (429, 403, 503):
                # rate-limited — exponential backoff
                wait = (2 ** attempt) + 1
                time.sleep(wait)
                continue
            raise
    raise RuntimeError(f"Together AI giving up after {retries} retries: {last_err}")

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--model", default="Qwen/Qwen3-Coder-30B-A3B-Instruct")
    ap.add_argument("--shots", type=int, default=5)
    args = ap.parse_args()

    token = os.environ.get("TOGETHER_API_KEY")
    if not token: raise SystemExit("Set TOGETHER_API_KEY")

    schema = SCHEMA.read_text()
    eval_set = [json.loads(l) for l in EVAL.read_text().splitlines() if l.strip()]
    seed = [json.loads(l) for l in SEED.read_text().splitlines() if l.strip()]
    seen_cat, shots = set(), []
    for p in seed:
        if p["category"] in seen_cat: continue
        seen_cat.add(p["category"]); shots.append(p)
        if len(shots) >= args.shots: break
    print(f"model={args.model} shots={len(shots)} eval={len(eval_set)}")

    cur = sqlite3.connect(DB).cursor()
    sys_msg = SYSTEM + "\n\nSCHEMA:\n" + schema
    results, exec_correct, exact_correct = [], 0, 0

    for i, ex in enumerate(eval_set, 1):
        msgs = [{"role": "system", "content": sys_msg}]
        for s in shots:
            msgs.append({"role": "user", "content": s["question"]})
            msgs.append({"role": "assistant", "content": s["sql"]})
        msgs.append({"role": "user", "content": ex["question"]})
        time.sleep(1.5)  # be polite to free-tier rate limits
        try:
            gen = call_together(token, args.model, msgs)
        except Exception as e:
            print(f"  {i:2d} API ERROR: {e}")
            results.append({"i": i, "category": ex["category"], "question": ex["question"],
                            "gold_sql": ex["sql"], "pred_sql": "", "pred_runs": False,
                            "exec_match": False, "exact_match": False, "error": str(e)})
            continue
        pred = extract_sql(gen)
        try: cur.execute(ex["sql"]); gold = cur.fetchall()
        except sqlite3.Error: gold = None
        try: cur.execute(pred); pr = cur.fetchall(); runs = True
        except sqlite3.Error: pr = None; runs = False
        exec_ok = runs and gold is not None and rows_eq(gold, pr)
        exact_ok = normalize(pred) == normalize(ex["sql"])
        if exec_ok: exec_correct += 1
        if exact_ok: exact_correct += 1
        results.append({"i": i, "category": ex["category"], "question": ex["question"],
                        "gold_sql": ex["sql"], "pred_sql": pred,
                        "pred_runs": runs, "exec_match": exec_ok, "exact_match": exact_ok})
        print(f"  {i:2d}/{len(eval_set)}  exec={'Y' if exec_ok else 'n'}  "
              f"exact={'Y' if exact_ok else 'n'}  {ex['category']:14s}  {ex['question'][:50]}")

    slug = args.model.replace("/", "_").replace(".", "_")
    OUT = ROOT / "data" / f"baseline_together_{slug}.jsonl"
    SUM = ROOT / "data" / f"baseline_together_{slug}.txt"
    OUT.write_text("\n".join(json.dumps(r) for r in results) + "\n")
    n = len(eval_set)
    summary = (
        f"=== Together AI {args.model} ({args.shots}-shot) ===\n"
        f"eval set: {n}\n\n"
        f"Execution accuracy: {exec_correct}/{n}  =  {100*exec_correct/n:.1f}%\n"
        f"Exact-match:        {exact_correct}/{n}  =  {100*exact_correct/n:.1f}%\n"
    )
    SUM.write_text(summary)
    print("\n" + summary)
    return 0

if __name__ == "__main__":
    sys.exit(main())
