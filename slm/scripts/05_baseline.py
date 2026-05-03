"""
Baseline accuracy of prompted Llama-3.1-8B-Instruct on the held-out eval set.

This is the bar the fine-tuned model must beat. We give Llama the schema and
5 in-context examples (drawn from seed.jsonl, NOT eval.jsonl), then ask it
to produce SQL for each of the 20 eval questions.

Two metrics:
  * EXEC ACCURACY — does the generated SQL execute and return the SAME row set
    as the gold SQL? (canonical truth — this is what the user actually wants)
  * EXACT MATCH   — does normalized SQL string equal the gold? (strict, often
    fails for trivially-equivalent queries; reported only as a sanity number)

If exec accuracy already ≥85%, fine-tuning probably can't beat it by much
and you should reconsider whether to train at all.

Output:
  data/baseline.jsonl         — every prediction with verdict
  data/baseline_summary.txt   — single-page report
"""
from __future__ import annotations
import json
import re
import sqlite3
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval.jsonl"
SEED = ROOT / "data" / "seed.jsonl"
SCHEMA = ROOT / "data" / "schema_prompt.txt"
DB = ROOT / "data" / "awards-warehouse.db"
OUT = ROOT / "data" / "baseline.jsonl"
SUMMARY = ROOT / "data" / "baseline_summary.txt"

MODEL_NAME = "meta-llama/Llama-3.1-8B-Instruct"
N_SHOTS = 5

SYSTEM = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query that answers it.
Do not include explanation, markdown fences, or commentary — just the SQL ending with a semicolon."""

def load_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]

def normalize(sql: str) -> str:
    s = sql.strip().rstrip(";").lower()
    return re.sub(r"\s+", " ", s)

def rows_eq(a: list, b: list) -> bool:
    """Order-insensitive row comparison (most queries don't ORDER BY)."""
    return sorted(map(repr, a)) == sorted(map(repr, b))

def extract_sql(text: str) -> str:
    text = text.strip()
    # strip ```sql ... ``` if present
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m: text = m.group(1)
    # take first statement up to first semicolon (or whole if no semi)
    m = re.match(r"\s*(.*?;)", text, re.DOTALL)
    if m: text = m.group(1)
    return text.strip()

def build_prompt(schema: str, shots: list[dict], question: str) -> list[dict]:
    msgs = [{"role": "system", "content": SYSTEM + "\n\nSCHEMA:\n" + schema}]
    for s in shots:
        msgs.append({"role": "user", "content": s["question"]})
        msgs.append({"role": "assistant", "content": s["sql"]})
    msgs.append({"role": "user", "content": question})
    return msgs

def main() -> int:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    schema = SCHEMA.read_text()
    eval_set = load_jsonl(EVAL)
    seed = load_jsonl(SEED)
    # Pick diverse few-shot examples — one per category, capped at N_SHOTS
    seen_cat, shots = set(), []
    for p in seed:
        if p["category"] in seen_cat: continue
        seen_cat.add(p["category"]); shots.append(p)
        if len(shots) >= N_SHOTS: break
    print(f"loaded eval={len(eval_set)} shots={len(shots)}")

    print(f"loading {MODEL_NAME} (4-bit)...")
    bnb = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
    )
    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME, quantization_config=bnb, device_map="auto", torch_dtype=torch.bfloat16,
    )
    model.eval()

    cur = sqlite3.connect(DB).cursor()
    results, exec_correct, exact_correct = [], 0, 0

    for i, ex in enumerate(eval_set, 1):
        msgs = build_prompt(schema, shots, ex["question"])
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        ids = tok(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **ids, max_new_tokens=400, do_sample=False, temperature=0.0,
                pad_token_id=tok.eos_token_id,
            )
        gen = tok.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True)
        pred = extract_sql(gen)

        # Score
        try:
            cur.execute(ex["sql"]); gold_rows = cur.fetchall()
        except sqlite3.Error as e:
            gold_rows = None
        try:
            cur.execute(pred); pred_rows = cur.fetchall(); pred_runs = True
        except sqlite3.Error as e:
            pred_rows = None; pred_runs = False
        exec_ok = pred_runs and gold_rows is not None and rows_eq(gold_rows, pred_rows)
        exact_ok = normalize(pred) == normalize(ex["sql"])
        if exec_ok: exec_correct += 1
        if exact_ok: exact_correct += 1
        results.append({
            "i": i, "category": ex["category"], "question": ex["question"],
            "gold_sql": ex["sql"], "pred_sql": pred,
            "pred_runs": pred_runs, "exec_match": exec_ok, "exact_match": exact_ok,
        })
        print(f"  {i:2d}/{len(eval_set)}  exec={'Y' if exec_ok else 'n'}  exact={'Y' if exact_ok else 'n'}  {ex['category']:12s}")

    OUT.write_text("\n".join(json.dumps(r) for r in results) + "\n")
    n = len(eval_set)
    summary = (
        f"=== Baseline (prompted Llama-3.1-8B-Instruct, {N_SHOTS}-shot) ===\n"
        f"eval set: {n} questions\n\n"
        f"Execution accuracy: {exec_correct}/{n}  =  {100*exec_correct/n:.1f}%\n"
        f"Exact-match:        {exact_correct}/{n}  =  {100*exact_correct/n:.1f}%\n\n"
        f"Per-category execution accuracy:\n"
    )
    by_cat: dict[str, list] = {}
    for r in results: by_cat.setdefault(r["category"], []).append(r["exec_match"])
    for cat, hits in sorted(by_cat.items()):
        summary += f"  {sum(hits)}/{len(hits)}  {cat}\n"
    SUMMARY.write_text(summary)
    print("\n" + summary)
    return 0

if __name__ == "__main__":
    sys.exit(main())
