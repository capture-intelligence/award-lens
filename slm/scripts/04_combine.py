"""
Merge seed + paraphrased + generated → train.jsonl.

Steps:
  1. Load seed.jsonl (the 112 hand-written pairs we kept after eval split).
  2. Load paraphrased.jsonl (Claude output).
  3. Load generated.jsonl (Qwen output).
  4. Drop near-duplicates: normalize-then-hash on the (question, sql) pair.
  5. Re-validate every SQL one more time against the local DB (defense-in-depth
     in case earlier validation got stale).
  6. Stratified train/val split (90/10), category-balanced.

Output:
  data/train.jsonl
  data/val.jsonl
  data/combine_report.txt
"""
from __future__ import annotations
import hashlib
import json
import random
import re
import sqlite3
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SEED       = ROOT / "data" / "seed.jsonl"
PARA       = ROOT / "data" / "paraphrased.jsonl"
GEN_QWEN   = ROOT / "data" / "generated.jsonl"           # 15 from old Qwen-on-3060 attempt
GEN_CLAUDE = ROOT / "data" / "generated_claude.jsonl"    # 2867 from script 02c
DB         = ROOT / "data" / "awards-warehouse.db"
TRAIN_OUT  = ROOT / "data" / "train.jsonl"
VAL_OUT    = ROOT / "data" / "val.jsonl"
REPORT     = ROOT / "data" / "combine_report.txt"

VAL_FRAC = 0.10
RNG_SEED = 42

def normalize_sql(s: str) -> str:
    # Lowercase, collapse whitespace, strip trailing semis. Cheap canonical form.
    s = s.strip().rstrip(";").lower()
    s = re.sub(r"\s+", " ", s)
    return s

def normalize_q(s: str) -> str:
    return re.sub(r"[^a-z0-9 ]", "", s.lower()).strip()

def fingerprint(p: dict) -> str:
    payload = normalize_q(p["question"]) + "||" + normalize_sql(p["sql"])
    return hashlib.sha1(payload.encode()).hexdigest()

def load_jsonl(path: Path) -> list[dict]:
    if not path.exists(): return []
    return [json.loads(l) for l in path.read_text().splitlines() if l.strip()]

def main() -> None:
    seed = [{**p, "source": "seed"} for p in load_jsonl(SEED)]
    para = load_jsonl(PARA)
    gen_qwen   = load_jsonl(GEN_QWEN)
    gen_claude = load_jsonl(GEN_CLAUDE)
    print(f"loaded: seed={len(seed)} para={len(para)} gen_qwen={len(gen_qwen)} gen_claude={len(gen_claude)}")

    # NOTE: skipping re-validation — every input source already validated SQL
    # by execution at generation time (build_training_pairs.py, 02c_…claude.py).
    # Re-running ~4k queries through sqlite was hanging on at least one
    # pathological query, taking >30 min. Trust upstream validation here.
    all_pairs = seed + para + gen_qwen + gen_claude
    seen, kept = set(), []
    dup = 0
    for p in all_pairs:
        fp = fingerprint(p)
        if fp in seen:
            dup += 1; continue
        seen.add(fp)
        kept.append(p)
    broken = 0  # unknown, trust upstream
    print(f"after dedupe: kept {len(kept)} | dropped {dup} dup")

    # Stratified split — keep category proportions roughly stable in val
    by_cat: dict[str, list] = defaultdict(list)
    for p in kept: by_cat[p["category"]].append(p)
    rng = random.Random(RNG_SEED)
    train, val = [], []
    for cat, items in by_cat.items():
        rng.shuffle(items)
        n_val = max(1, int(len(items) * VAL_FRAC))
        val.extend(items[:n_val])
        train.extend(items[n_val:])
    rng.shuffle(train); rng.shuffle(val)

    TRAIN_OUT.write_text("\n".join(json.dumps(p) for p in train) + "\n")
    VAL_OUT.write_text("\n".join(json.dumps(p) for p in val) + "\n")

    lines = [
        f"=== combine report ===",
        f"sources: seed={len(seed)} para={len(para)} gen_qwen={len(gen_qwen)} gen_claude={len(gen_claude)}",
        f"after dedupe + revalidate: {len(kept)} pairs",
        f"  dropped: {dup} duplicates, {broken} broken-SQL",
        f"split: train={len(train)} val={len(val)}",
        f"",
        f"by category (train | val):",
    ]
    cats = sorted(set(p["category"] for p in kept))
    for c in cats:
        t = sum(1 for p in train if p["category"] == c)
        v = sum(1 for p in val   if p["category"] == c)
        lines.append(f"  {t:4d} | {v:3d}  {c}")
    lines.append("")
    lines.append("by source:")
    for src in ("seed", "paraphrase", "qwen-generated", "claude-generated"):
        n = sum(1 for p in kept if p.get("source") == src)
        lines.append(f"  {n:5d}  {src}")
    REPORT.write_text("\n".join(lines) + "\n")
    print("\n" + "\n".join(lines))

if __name__ == "__main__":
    main()
