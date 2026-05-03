"""
Lock 20 of the 131 hand-written pairs as the held-out eval set.

Stratified by category so easy/hard/edge cases are all represented.
Eval set is NEVER touched by training. The remaining 111 form the SEED for
synthetic expansion (script 02).

Outputs:
  data/eval.jsonl       — 20 pairs, gold reference for accuracy measurement
  data/seed.jsonl       — 111 pairs, used as anchors for synthetic expansion
"""
from __future__ import annotations
import json
import random
from collections import defaultdict
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SRC = ROOT / "data" / "training_pairs.jsonl"
EVAL_OUT = ROOT / "data" / "eval.jsonl"
SEED_OUT = ROOT / "data" / "seed.jsonl"

EVAL_SIZE = 20
RANDOM_SEED = 42

def main() -> None:
    rng = random.Random(RANDOM_SEED)
    pairs = [json.loads(line) for line in SRC.read_text().splitlines() if line.strip()]
    print(f"Loaded {len(pairs)} pairs")

    by_cat: dict[str, list] = defaultdict(list)
    for p in pairs:
        by_cat[p["category"]].append(p)

    # Stratified: take ~proportional from each category, shuffled
    eval_set = []
    seed_set = []
    target_per_cat = max(1, EVAL_SIZE // len(by_cat))
    for cat, items in by_cat.items():
        rng.shuffle(items)
        take = min(target_per_cat, max(1, len(items) // 5))  # cap at 20% per category
        eval_set.extend(items[:take])
        seed_set.extend(items[take:])

    # If we overshot/undershot, balance by moving from the largest leftover bucket
    while len(eval_set) > EVAL_SIZE:
        seed_set.append(eval_set.pop())
    rng.shuffle(seed_set)
    while len(eval_set) < EVAL_SIZE:
        eval_set.append(seed_set.pop())

    EVAL_OUT.write_text("\n".join(json.dumps(p) for p in eval_set) + "\n")
    SEED_OUT.write_text("\n".join(json.dumps(p) for p in seed_set) + "\n")

    print(f"Wrote {len(eval_set)} eval pairs → {EVAL_OUT}")
    print(f"Wrote {len(seed_set)} seed pairs → {SEED_OUT}")

    # Show eval distribution so we know it's balanced
    eval_cats: dict[str, int] = defaultdict(int)
    for p in eval_set:
        eval_cats[p["category"]] += 1
    print("\nEval set by category:")
    for cat, n in sorted(eval_cats.items(), key=lambda x: -x[1]):
        print(f"  {n:2d}  {cat}")

if __name__ == "__main__":
    main()
