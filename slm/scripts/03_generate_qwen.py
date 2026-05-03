"""
Local novel-pair generation with Qwen2.5-Coder-7B-Instruct.

For each schema-based category, prompt Qwen to invent net-new (question, SQL)
pairs given the schema. Every produced SQL is executed against the local DB
and dropped if it fails — execution-validation is what makes generated data
usable.

Hardware: tested on RTX 3060 12 GB. Loads Qwen-7B in 4-bit (~5 GB),
generates at ~25-35 tok/s. Expect ~5-8 hours for ~3k pairs.

Usage:
  HF_TOKEN=hf_... python3 scripts/03_generate_qwen.py [--dry-run]
                                                       [--batches-per-cat N]
                                                       [--batch-size N]

Output: data/generated.jsonl
"""
from __future__ import annotations
import argparse
import json
import re
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA_PATH = ROOT / "data" / "schema_prompt.txt"
DB_PATH = ROOT / "data" / "awards-warehouse.db"
OUT_PATH = ROOT / "data" / "generated.jsonl"
LOG_PATH = ROOT / "data" / "generate.log"

MODEL_NAME = "Qwen/Qwen2.5-Coder-7B-Instruct"

CATEGORIES = [
    ("simple",       "single-table SELECTs with filters and LIMITs"),
    ("aggregation",  "GROUP BY, SUM/AVG/COUNT/MAX/MIN, HAVING"),
    ("join",         "joins among award, vendor, organization, naics_code, psc_code, contracting_office"),
    ("ranking",      "top-N queries with ORDER BY ... LIMIT, ties via RANK"),
    ("time",         "date-window filters using SUBSTR, DATE('now',...), strftime, julianday"),
    ("geo",          "queries against award_performance_location.state/city/country_code"),
    ("naics_psc",    "NAICS family filters (LIKE '5415%'), PSC categories"),
    ("cdc",          "join award_federal_account → cdc_center to attribute spend; cdc_center_override"),
    ("compliance",   "sam_exclusion lookups, vendor cross-checks via UEI, exclusion timelines"),
    ("grants",       "grant_opportunity by status/category/funding_instrument, deadline math"),
    ("mods",         "award_modification: action_type, obligation_delta, mod_number"),
    ("ops",          "ingestion_run, reconciliation_check, drift analysis"),
    ("subquery",     "EXISTS / NOT EXISTS / IN / NOT IN; correlated subqueries"),
    ("window",       "ROW_NUMBER, RANK, LAG, SUM() OVER (PARTITION BY...)"),
    ("edge",         "NULL handling, COALESCE, CASE buckets"),
    ("natural",      "freeform business questions a federal-BD analyst would ask"),
    ("text_search",  "LIKE %keyword% on description / title / legal_name"),
    ("lookalike",    "find awards similar to a seed (same NAICS/PSC, value range) at OTHER agencies"),
    ("recompete",    "awards expiring soon at agencies the user doesn't currently work with"),
    ("admin",        "app_user, view_access, filter_access governance"),
    ("views",        "data_view + view_award membership analytics"),
    ("analytical",   "concentration ratios, year-over-year deltas, multi-step CTEs"),
]

def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG_PATH.open("a") as f: f.write(line + "\n")

def extract_json_array(text: str) -> list:
    text = text.strip()
    if text.startswith("```"):
        text = re.sub(r"^```[a-z]*\n?", "", text)
        text = re.sub(r"\n?```$", "", text)
    m = re.search(r"\[.*\]", text, re.DOTALL)
    if m: text = m.group(0)
    try:
        arr = json.loads(text)
        return arr if isinstance(arr, list) else []
    except json.JSONDecodeError:
        return []

def validate_sql(cur: sqlite3.Cursor, sql: str) -> tuple[bool, str | None, int]:
    try:
        cur.execute(sql)
        rows = cur.fetchall()
        return True, None, len(rows)
    except sqlite3.Error as e:
        return False, str(e), 0

def build_prompt(schema: str, category: str, hint: str, n: int) -> str:
    return f"""You write training pairs for a text-to-SQL model targeting a SQLite database of federal contracts and grants.

SCHEMA:
{schema}

Generate exactly {n} (question, sql) pairs for the category below. Output ONLY a JSON array of objects with keys "question" and "sql", no prose.

Rules:
- SQL must be valid SQLite. No placeholders (?). Use literal values.
- Do not invent columns or tables.
- Mix difficulty within the batch.
- Questions sound like real users (BD analysts, contract officers), not templates.

CATEGORY: {category}
HINT: {hint}

JSON array:"""

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--batches-per-cat", type=int, default=8)
    ap.add_argument("--batch-size", type=int, default=6)
    ap.add_argument("--max-new-tokens", type=int, default=1800)
    ap.add_argument("--limit-cats", type=int, default=0, help="0=all categories")
    args = ap.parse_args()

    LOG_PATH.unlink(missing_ok=True)
    OUT_PATH.unlink(missing_ok=True)

    cats = CATEGORIES if not args.limit_cats else CATEGORIES[:args.limit_cats]
    expected = len(cats) * args.batches_per_cat * args.batch_size
    log(f"start: {len(cats)} categories × {args.batches_per_cat} batches × {args.batch_size} pairs ≈ {expected} raw pairs")

    if args.dry_run:
        log("DRY: would load Qwen2.5-Coder-7B and generate; exiting")
        return 0

    # Lazy import — torch+transformers take ~20s to init
    log("loading torch + transformers + Qwen (4-bit)...")
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig

    bnb = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_quant_type="nf4",
        bnb_4bit_use_double_quant=True,
    )
    tok = AutoTokenizer.from_pretrained(MODEL_NAME)
    model = AutoModelForCausalLM.from_pretrained(
        MODEL_NAME, quantization_config=bnb, device_map="auto", torch_dtype=torch.bfloat16,
    )
    model.eval()
    log(f"model loaded. cuda mem: {torch.cuda.memory_allocated()/1e9:.1f} GB")

    schema = SCHEMA_PATH.read_text()
    cur = sqlite3.connect(DB_PATH).cursor()

    kept, dropped = [], 0
    for cat, hint in cats:
        for b in range(args.batches_per_cat):
            prompt = build_prompt(schema, cat, hint, args.batch_size)
            messages = [{"role": "user", "content": prompt}]
            text = tok.apply_chat_template(messages, tokenize=False, add_generation_prompt=True)
            ids = tok(text, return_tensors="pt").to(model.device)
            t0 = time.time()
            with torch.no_grad():
                out = model.generate(
                    **ids, max_new_tokens=args.max_new_tokens, do_sample=True,
                    temperature=0.7, top_p=0.9, repetition_penalty=1.05,
                    pad_token_id=tok.eos_token_id,
                )
            gen = tok.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True)
            arr = extract_json_array(gen)
            batch_kept = 0
            for item in arr:
                if not isinstance(item, dict): continue
                q, sql = item.get("question"), item.get("sql")
                if not (isinstance(q, str) and isinstance(sql, str) and q.strip() and sql.strip()):
                    continue
                ok, err, rc = validate_sql(cur, sql)
                if ok:
                    kept.append({
                        "category":   cat,
                        "difficulty": "medium",
                        "question":   q.strip(),
                        "sql":        sql.strip(),
                        "row_count":  rc,
                        "source":     "qwen-generated",
                    })
                    batch_kept += 1
                else:
                    dropped += 1
            log(f"  {cat} b{b+1}/{args.batches_per_cat}: kept {batch_kept}/{len(arr)} (dropped {dropped} cumulative) {time.time()-t0:.1f}s")

            # Persist incrementally — if we crash overnight, we keep progress
            with OUT_PATH.open("a") as f:
                for r in kept[-batch_kept:]:
                    f.write(json.dumps(r) + "\n")

    log(f"DONE: kept {len(kept)} | dropped {dropped} (failed SQL validation)")
    by_cat: dict[str, int] = defaultdict(int)
    for r in kept: by_cat[r["category"]] += 1
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        log(f"  {n:4d}  {cat}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
