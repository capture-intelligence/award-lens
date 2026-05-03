"""
Test bare SQLCoder-7B-2 on Workers AI free tier — no fine-tuning.

If this hits ≥65% on our 20-question eval with 5-shot prompting, we ship it
as-is at $0/mo and skip fine-tuning entirely.

Auth: same wrangler OAuth extraction as 05b_baseline_workers_ai.py.

Output:
  data/baseline_sqlcoder.jsonl
  data/baseline_sqlcoder.txt
"""
from __future__ import annotations
import json
import os
import re
import sqlite3
import sys
import time
import urllib.request
import urllib.error
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval.jsonl"
SEED = ROOT / "data" / "seed.jsonl"
SCHEMA = ROOT / "data" / "schema_compact.txt"
DB = ROOT / "data" / "awards-warehouse.db"
OUT = ROOT / "data" / "baseline_sqlcoder.jsonl"
SUMMARY = ROOT / "data" / "baseline_sqlcoder.txt"

MODEL = "@cf/defog/sqlcoder-7b-2"
N_SHOTS = 5

# SQLCoder uses a specific instruction format. Workers AI exposes it via
# the standard chat completions API — we'll use chat-format with the schema
# in the system prompt and Q/A pairs as user/assistant turns.
SYSTEM = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query that answers it.
Do not include explanation, markdown fences, or commentary — just the SQL ending with a semicolon."""

def load_token_and_account() -> tuple[str, str]:
    cfg = Path.home() / ".config/.wrangler/config/default.toml"
    txt = cfg.read_text()
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', txt)
    if not m: raise SystemExit("Could not find oauth_token in wrangler config")
    return m.group(1), os.environ.get("CF_ACCOUNT_ID") or "f91a8ed8d60f3830e1821866fa2857e5"

def call_workers_ai(token: str, account: str, messages: list[dict]) -> str:
    url = f"https://api.cloudflare.com/client/v4/accounts/{account}/ai/run/{MODEL}"
    body = json.dumps({"messages": messages, "max_tokens": 400, "temperature": 0.0}).encode()
    req = urllib.request.Request(url, data=body, headers={
        "Authorization": f"Bearer {token}",
        "Content-Type": "application/json",
    }, method="POST")
    with urllib.request.urlopen(req, timeout=60) as r:
        data = json.loads(r.read())
    if not data.get("success"):
        raise RuntimeError(f"Workers AI error: {data.get('errors')}")
    return data["result"]["response"]

def normalize(sql: str) -> str:
    return re.sub(r"\s+", " ", sql.strip().rstrip(";").lower())

def rows_eq(a, b) -> bool:
    return sorted(map(repr, a)) == sorted(map(repr, b))

def extract_sql(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m: text = m.group(1)
    # SQLCoder sometimes ends without a semicolon — accept first statement
    m = re.match(r"\s*(.*?;)", text, re.DOTALL)
    if m: text = m.group(1)
    return text.strip()

def main() -> int:
    token, account = load_token_and_account()
    schema = SCHEMA.read_text()
    eval_set = [json.loads(l) for l in EVAL.read_text().splitlines() if l.strip()]
    seed = [json.loads(l) for l in SEED.read_text().splitlines() if l.strip()]
    seen_cat, shots = set(), []
    for p in seed:
        if p["category"] in seen_cat: continue
        seen_cat.add(p["category"]); shots.append(p)
        if len(shots) >= N_SHOTS: break

    print(f"model={MODEL} shots={len(shots)} eval={len(eval_set)}", flush=True)
    cur = sqlite3.connect(DB).cursor()
    sys_msg = SYSTEM + "\n\nSCHEMA:\n" + schema
    results, exec_correct, exact_correct = [], 0, 0

    for i, ex in enumerate(eval_set, 1):
        msgs = [{"role": "system", "content": sys_msg}]
        for s in shots:
            msgs.append({"role": "user", "content": s["question"]})
            msgs.append({"role": "assistant", "content": s["sql"]})
        msgs.append({"role": "user", "content": ex["question"]})
        try:
            gen = call_workers_ai(token, account, msgs)
        except Exception as e:
            print(f"  {i:2d} API ERROR: {e}", flush=True)
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
              f"exact={'Y' if exact_ok else 'n'}  {ex['category']:12s}  {ex['question'][:50]}", flush=True)

    OUT.write_text("\n".join(json.dumps(r) for r in results) + "\n")
    n = len(eval_set)
    summary = (
        f"=== Workers AI {MODEL} ({N_SHOTS}-shot, no fine-tune) ===\n"
        f"eval set: {n}\n\n"
        f"Execution accuracy: {exec_correct}/{n}  =  {100*exec_correct/n:.1f}%\n"
        f"Exact-match:        {exact_correct}/{n}  =  {100*exact_correct/n:.1f}%\n"
    )
    SUMMARY.write_text(summary)
    print("\n" + summary, flush=True)
    return 0

if __name__ == "__main__":
    sys.exit(main())
