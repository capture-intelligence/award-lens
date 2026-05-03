"""
Claude-powered novel (question, SQL) generation.

Different from 02_paraphrase_claude.py: that one took a seed and rewrote the
question. This one generates entirely new pairs, schema-aware, validated by
execution.

Strategy:
  - Per category, call Claude with: schema + 2-3 seed examples for anchoring
    + an instruction to produce DIFFERENT pairs in the same category.
  - Heavy weight on categories v1 failed: window functions, CTEs, complex
    joins, subqueries, date arithmetic, lookalike/recompete.
  - Every generated SQL is executed against awards-warehouse.db; drop the
    broken ones.
  - Resumable: appends to output file; re-running picks up where it left off.

Budget: ~$8-12 with default settings (≈3000 pairs targeted).

Usage:
  ANTHROPIC_API_KEY=... python3 scripts/02c_generate_novel_claude.py [--dry-run]
                                                                      [--target 3000]
"""
from __future__ import annotations
import argparse
import hashlib
import json
import os
import random
import re
import sqlite3
import sys
import time
from collections import defaultdict
from pathlib import Path

try:
    from anthropic import Anthropic
except ImportError:
    print("pip install anthropic", file=sys.stderr); sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SEED = ROOT / "data" / "seed.jsonl"          # 112 hand-written pairs
SCHEMA = ROOT / "data" / "schema_compact.txt"
DB = ROOT / "data" / "awards-warehouse.db"
OUT = ROOT / "data" / "generated_claude.jsonl"
LOG = ROOT / "data" / "generate_claude.log"

MODEL = "claude-sonnet-4-5"
BATCH_SIZE = 6   # pairs per API call

# (category, hint, weight) — weight controls relative effort allocation
CATEGORY_PLAN = [
    # v1 failure modes — weight 3
    ("window",       "ROW_NUMBER/RANK/DENSE_RANK/LAG/LEAD; SUM/AVG OVER (PARTITION BY); per-group top-N", 3),
    ("cte",          "WITH name AS (...) for multi-step: compute aggregates first then filter, or chain transforms", 3),
    ("complex_join", "join 3+ tables: award+organization+vendor, award+afa+cdc_center, etc.", 3),
    ("subquery",     "EXISTS / NOT EXISTS / IN / NOT IN / correlated subqueries; WHERE col = (SELECT ...)", 3),
    ("date_math",    "DATE('now', '-N days'), julianday, strftime, BETWEEN, period-of-performance overlaps", 3),
    ("aggregation_complex", "GROUP BY multiple cols, HAVING, COUNT(DISTINCT), nested aggregates", 3),

    # BD product features — weight 2 (forward-looking, not v1-failed)
    ("lookalike",    "find awards similar to a seed (same NAICS+PSC, ±20% value, ±2y POP) at OTHER agencies", 2),
    ("recompete",    "awards with pop_end_date in next 6-18mo at agencies the user doesn't currently work with — competitor incumbent analysis", 2),
    ("market_size",  "estimate total addressable spend for a NAICS/PSC combination over a date window", 2),
    ("vendor_breadth", "vendors active across multiple agencies / multiple NAICS — diversification analysis", 2),

    # Coverage backfill — weight 1
    ("simple",         "single-table SELECT with a filter and LIMIT", 1),
    ("aggregation",    "basic GROUP BY + COUNT/SUM/AVG", 1),
    ("ranking",        "ORDER BY ... LIMIT for top-N", 1),
    ("time",           "filter by year/quarter/month using SUBSTR or strftime", 1),
    ("geo",            "queries against award_performance_location.state/city/country_code", 1),
    ("naics_psc",      "NAICS family LIKE '5415%', PSC categories", 1),
    ("cdc",            "join award_federal_account → cdc_center; cdc_center_override", 1),
    ("compliance",     "sam_exclusion lookups, vendor cross-checks via UEI", 1),
    ("grants",         "grant_opportunity by status/category/funding_instrument, deadline math", 1),
    ("mods",           "award_modification: action_type, obligation_delta, mod_number", 1),
    ("ops",            "ingestion_run, reconciliation_check, drift analysis", 1),
    ("edge",           "NULL handling, COALESCE, CASE buckets", 1),
    ("natural",        "freeform business questions an analyst would ask", 1),
    ("text_search",    "LIKE %keyword% on description / title / legal_name", 1),
]

SYSTEM = """You generate (question, SQL) training pairs for a text-to-SQL model targeting a SQLite database of US federal contracts and grants.

Your job: produce DIVERSE, NOVEL pairs in the requested category. Every SQL query must be valid SQLite and executable against the schema below.

Quality bar:
- Questions must sound like real users (BD analysts, contract officers, policy researchers, vendor strategists). Vary tone, length, vocabulary, formality.
- SQL must be idiomatic — choose the right table for each column, prefer JOINs over correlated subqueries when both work, use clear column aliases.
- Mix difficulty within the batch: some easy, some hard.
- Do NOT copy the seed examples — they are anchors to show the category, not templates to replicate.
- Use literal values (no `?` placeholders); when an example value matters, pick a plausible one (e.g., "Centers for Disease Control and Prevention", NAICS "541512", "MODERNATX, INC.").

Output rules (CRITICAL):
- Output ONLY a JSON array of objects: `[{"question": "...", "sql": "..."}, ...]`
- No prose, no markdown fences, no commentary.
- The SQL field must be a single statement ending with semicolon.
- Do not invent columns or tables not in the schema.

SCHEMA:
{schema}"""

def log(msg: str) -> None:
    line = f"[{time.strftime('%H:%M:%S')}] {msg}"
    print(line, flush=True)
    with LOG.open("a") as f: f.write(line + "\n")

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

def fingerprint(q: str, sql: str) -> str:
    qs = re.sub(r"[^a-z0-9 ]", "", q.lower()).strip()
    ss = re.sub(r"\s+", " ", sql.strip().rstrip(";").lower())
    return hashlib.sha1((qs + "||" + ss).encode()).hexdigest()

def load_existing_fingerprints() -> set:
    seen = set()
    for path in (SEED, OUT):
        if not path.exists(): continue
        for line in path.read_text().splitlines():
            if not line.strip(): continue
            try:
                p = json.loads(line)
                seen.add(fingerprint(p["question"], p["sql"]))
            except (json.JSONDecodeError, KeyError):
                pass
    return seen

def load_seed_examples_by_category() -> dict[str, list[dict]]:
    by_cat: dict[str, list] = defaultdict(list)
    if SEED.exists():
        for line in SEED.read_text().splitlines():
            if not line.strip(): continue
            p = json.loads(line)
            by_cat[p["category"]].append(p)
    return dict(by_cat)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--target", type=int, default=3000, help="rough total pairs to generate")
    ap.add_argument("--max-batches", type=int, default=600, help="hard cap on API calls")
    args = ap.parse_args()

    if not args.dry_run and not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY", file=sys.stderr); return 1

    schema = SCHEMA.read_text()
    sys_msg = SYSTEM.replace("{schema}", schema)
    seed_by_cat = load_seed_examples_by_category()
    seen_fp = load_existing_fingerprints()
    log(f"start: target={args.target} max_batches={args.max_batches}")
    log(f"existing fingerprints loaded: {len(seen_fp)}")

    # Allocate batches per category proportional to weight
    total_weight = sum(w for _, _, w in CATEGORY_PLAN)
    target_batches = min(args.max_batches, args.target // BATCH_SIZE)
    cat_quota = {cat: max(1, int(target_batches * w / total_weight))
                 for cat, _, w in CATEGORY_PLAN}
    log(f"per-category quota: {cat_quota}")

    if args.dry_run:
        log(f"DRY: would emit ~{sum(cat_quota.values()) * BATCH_SIZE} candidate pairs")
        return 0

    client = Anthropic()
    cur = sqlite3.connect(DB).cursor()
    rng = random.Random(42)
    kept_total, dropped_total, dup_total = 0, 0, 0

    for cat, hint, _ in CATEGORY_PLAN:
        n_batches = cat_quota[cat]
        anchors = seed_by_cat.get(cat, [])[:8]  # up to 8 anchor examples
        for b in range(n_batches):
            # Sample 2-3 anchors at random; mention they're for category-shape reference only
            sample = rng.sample(anchors, min(3, len(anchors))) if anchors else []
            anchor_block = ""
            if sample:
                anchor_block = "Seed examples in this category (for shape only — do NOT replicate; produce DIFFERENT questions and DIFFERENT SQL):\n"
                for a in sample:
                    anchor_block += f"  - Q: {a['question']}\n    SQL: {a['sql']}\n"
                anchor_block += "\n"
            prompt = (
                f"{anchor_block}"
                f"Generate exactly {BATCH_SIZE} new (question, SQL) pairs for category={cat}.\n"
                f"HINT: {hint}\n"
                f"Return a JSON array of objects with keys 'question' and 'sql'."
            )
            try:
                resp = client.messages.create(
                    model=MODEL, max_tokens=3000, system=sys_msg,
                    messages=[{"role": "user", "content": prompt}],
                )
                arr = extract_json_array(resp.content[0].text)
            except Exception as e:
                log(f"  {cat} b{b+1}/{n_batches} API error: {e}"); continue

            batch_kept, batch_dropped, batch_dup = 0, 0, 0
            for item in arr:
                if not isinstance(item, dict): continue
                q, sql = item.get("question"), item.get("sql")
                if not (isinstance(q, str) and isinstance(sql, str) and q.strip() and sql.strip()):
                    batch_dropped += 1; continue
                fp = fingerprint(q, sql)
                if fp in seen_fp:
                    batch_dup += 1; continue
                # Validate execution
                try:
                    cur.execute(sql); rows = cur.fetchall()
                except sqlite3.Error:
                    batch_dropped += 1; continue
                seen_fp.add(fp)
                rec = {
                    "category": cat,
                    "difficulty": "medium",
                    "question": q.strip(),
                    "sql": sql.strip(),
                    "row_count": len(rows),
                    "source": "claude-generated",
                }
                with OUT.open("a") as f:
                    f.write(json.dumps(rec) + "\n")
                batch_kept += 1
            kept_total += batch_kept
            dropped_total += batch_dropped
            dup_total += batch_dup
            if (b + 1) % 4 == 0 or b == n_batches - 1:
                log(f"  {cat:18s} b{b+1:3d}/{n_batches:3d}  +{batch_kept} -{batch_dropped} dup{batch_dup}  | total kept={kept_total}")

    log(f"DONE: kept={kept_total} dropped={dropped_total} dup={dup_total}")
    by_cat: dict[str, int] = defaultdict(int)
    for line in OUT.read_text().splitlines():
        if line.strip(): by_cat[json.loads(line)["category"]] += 1
    log("by category:")
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        log(f"  {n:5d}  {cat}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
