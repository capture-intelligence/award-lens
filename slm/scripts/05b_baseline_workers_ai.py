"""
Baseline using Cloudflare Workers AI's hosted Llama-3.1-8B-Instruct.

This is the preferred baseline for our setup because:
  * It uses the EXACT model we'll fine-tune (no local-vs-hosted variance).
  * It's the deployment target — the comparison is "raw model in prod" vs
    "fine-tuned LoRA in prod", which is what actually matters.
  * It doesn't need local GPU (so it works while ours is locked).

Auth: extracts the OAuth token from `~/.config/.wrangler/config/default.toml`
and the account ID from `wrangler whoami`. No new secrets needed.

Output:
  data/baseline.jsonl
  data/baseline_summary.txt
"""
from __future__ import annotations
import json
import os
import re
import sqlite3
import sys
import time
from pathlib import Path

import urllib.request
import urllib.error

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval.jsonl"
SEED = ROOT / "data" / "seed.jsonl"
SCHEMA = ROOT / "data" / "schema_prompt.txt"
DB = ROOT / "data" / "awards-warehouse.db"
OUT = ROOT / "data" / "baseline.jsonl"
SUMMARY = ROOT / "data" / "baseline_summary.txt"

MODEL = "@cf/meta/llama-3.1-8b-instruct"
N_SHOTS = 5

SYSTEM = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query that answers it.
Do not include explanation, markdown fences, or commentary — just the SQL ending with a semicolon."""

def load_token_and_account() -> tuple[str, str]:
    cfg = Path.home() / ".config/.wrangler/config/default.toml"
    txt = cfg.read_text()
    m = re.search(r'oauth_token\s*=\s*"([^"]+)"', txt)
    if not m: raise SystemExit("Could not find oauth_token in wrangler config")
    token = m.group(1)
    # Account ID — try cache first, fall back to env
    acct = os.environ.get("CF_ACCOUNT_ID")
    if not acct:
        cache = ROOT.parent.parent / "workers/api/.wrangler/cache/wrangler-account.json"
        # Fallback: hardcoded from `wrangler whoami` output
        acct = "f91a8ed8d60f3830e1821866fa2857e5"
    return token, acct

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
    s = sql.strip().rstrip(";").lower()
    return re.sub(r"\s+", " ", s)

def rows_eq(a, b) -> bool:
    return sorted(map(repr, a)) == sorted(map(repr, b))

def extract_sql(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m: text = m.group(1)
    m = re.match(r"\s*(.*?;)", text, re.DOTALL)
    if m: text = m.group(1)
    return text.strip()

def load_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]

def main() -> int:
    token, account = load_token_and_account()
    schema = SCHEMA.read_text()
    eval_set = load_jsonl(EVAL)
    seed = load_jsonl(SEED)

    seen_cat, shots = set(), []
    for p in seed:
        if p["category"] in seen_cat: continue
        seen_cat.add(p["category"]); shots.append(p)
        if len(shots) >= N_SHOTS: break

    print(f"eval={len(eval_set)} shots={len(shots)} model={MODEL}")

    cur = sqlite3.connect(DB).cursor()
    results, exec_correct, exact_correct = [], 0, 0

    for i, ex in enumerate(eval_set, 1):
        msgs = [{"role": "system", "content": SYSTEM + "\n\nSCHEMA:\n" + schema}]
        for s in shots:
            msgs.append({"role": "user", "content": s["question"]})
            msgs.append({"role": "assistant", "content": s["sql"]})
        msgs.append({"role": "user", "content": ex["question"]})

        try:
            gen = call_workers_ai(token, account, msgs)
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
        results.append({
            "i": i, "category": ex["category"], "question": ex["question"],
            "gold_sql": ex["sql"], "pred_sql": pred,
            "pred_runs": runs, "exec_match": exec_ok, "exact_match": exact_ok,
        })
        print(f"  {i:2d}/{len(eval_set)}  exec={'Y' if exec_ok else 'n'}  "
              f"exact={'Y' if exact_ok else 'n'}  {ex['category']:12s}  "
              f"{ex['question'][:50]}")

    OUT.write_text("\n".join(json.dumps(r) for r in results) + "\n")
    n = len(eval_set)
    summary = (
        f"=== Baseline (Workers AI hosted Llama-3.1-8B, {N_SHOTS}-shot) ===\n"
        f"eval set: {n} questions\n\n"
        f"Execution accuracy: {exec_correct}/{n}  =  {100*exec_correct/n:.1f}%\n"
        f"Exact-match:        {exact_correct}/{n}  =  {100*exact_correct/n:.1f}%\n\n"
        f"Per-category execution accuracy:\n"
    )
    by_cat: dict[str, list] = {}
    for r in results: by_cat.setdefault(r["category"], []).append(r["exec_match"])
    for cat, hits in sorted(by_cat.items()):
        summary += f"  {sum(hits)}/{len(hits)}  {cat}\n"
    summary += "\nMissed questions (sample):\n"
    for r in results:
        if not r["exec_match"]:
            summary += f"\n  Q: {r['question']}\n"
            summary += f"  GOLD: {r['gold_sql'][:120]}\n"
            summary += f"  PRED: {r['pred_sql'][:120]}\n"
    SUMMARY.write_text(summary)
    print("\n" + summary)
    return 0

if __name__ == "__main__":
    sys.exit(main())
