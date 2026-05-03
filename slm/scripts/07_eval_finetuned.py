"""
Evaluate the fine-tuned LoRA on the held-out eval set.

Loads Llama-3.1-8B-Instruct + the LoRA adapter from out/llama31-8b-awards-sql,
runs the same protocol as 05_baseline.py, and prints both numbers side-by-side
so you can see the lift.

Output:
  data/finetuned.jsonl
  data/finetuned_summary.txt
"""
from __future__ import annotations
import json
import re
import sqlite3
import sys
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
EVAL = ROOT / "data" / "eval.jsonl"
SCHEMA = ROOT / "data" / "schema_compact.txt"
DB = ROOT / "data" / "awards-warehouse.db"
ADAPTER = ROOT / "out" / "llama31-8b-awards-sql"
BASELINE = ROOT / "data" / "baseline_summary.txt"
OUT = ROOT / "data" / "finetuned.jsonl"
SUMMARY = ROOT / "data" / "finetuned_summary.txt"

BASE_MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct"

SYSTEM = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query. Do not include explanation or fences — just SQL ending with semicolon.

SCHEMA:
{schema}"""

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

N_SHOTS = 5
SEED_PATH = ROOT / "data" / "seed.jsonl"

def main() -> int:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import PeftModel

    schema = SCHEMA.read_text()
    eval_set = [json.loads(l) for l in EVAL.read_text().splitlines() if l.strip()]
    # 5-shot context — same as baseline (apples-to-apples). One example per category.
    seed = [json.loads(l) for l in SEED_PATH.read_text().splitlines() if l.strip()] if SEED_PATH.exists() else []
    seen_cat, shots = set(), []
    for p in seed:
        if p["category"] in seen_cat: continue
        seen_cat.add(p["category"]); shots.append(p)
        if len(shots) >= N_SHOTS: break

    print(f"loading {BASE_MODEL} + LoRA from {ADAPTER}")
    bnb = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
    )
    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    base = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, quantization_config=bnb, device_map="auto", torch_dtype=torch.bfloat16,
    )
    model = PeftModel.from_pretrained(base, str(ADAPTER))
    model.eval()

    cur = sqlite3.connect(DB).cursor()
    sys_msg = SYSTEM.format(schema=schema)
    results, exec_correct, exact_correct = [], 0, 0
    for i, ex in enumerate(eval_set, 1):
        msgs = [{"role": "system", "content": sys_msg}]
        for s in shots:
            msgs.append({"role": "user", "content": s["question"]})
            msgs.append({"role": "assistant", "content": s["sql"]})
        msgs.append({"role": "user", "content": ex["question"]})
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        ids = tok(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **ids, max_new_tokens=400, do_sample=False, temperature=0.0,
                pad_token_id=tok.eos_token_id,
            )
        gen = tok.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True)
        pred = extract_sql(gen)

        try:
            cur.execute(ex["sql"]); gold = cur.fetchall()
        except sqlite3.Error: gold = None
        try:
            cur.execute(pred); pr = cur.fetchall(); runs = True
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
        print(f"  {i:2d}/{len(eval_set)}  exec={'Y' if exec_ok else 'n'}  exact={'Y' if exact_ok else 'n'}  {ex['category']}")

    OUT.write_text("\n".join(json.dumps(r) for r in results) + "\n")
    n = len(eval_set)
    summary = (
        f"=== Fine-tuned Llama-3.1-8B + LoRA ===\n"
        f"eval set: {n} questions\n\n"
        f"Execution accuracy: {exec_correct}/{n}  =  {100*exec_correct/n:.1f}%\n"
        f"Exact-match:        {exact_correct}/{n}  =  {100*exact_correct/n:.1f}%\n\n"
    )
    if BASELINE.exists():
        summary += "--- BASELINE (5-shot prompted, same model, no LoRA) ---\n"
        summary += BASELINE.read_text()
    SUMMARY.write_text(summary)
    print("\n" + summary)
    return 0

if __name__ == "__main__":
    sys.exit(main())
