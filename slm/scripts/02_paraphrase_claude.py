"""
Claude paraphrase pass — turns each of the 112 seed pairs into N alternative
phrasings of the SAME question (same SQL). This is what Claude is uniquely
good at: producing natural, varied English. Local Qwen does novel generation
in script 03.

Cost:
  112 seeds × 8 paraphrases ≈ 900 pairs.
  Each call ~600 input tok + ~400 output tok.
  At Sonnet 4.5 ($3/Mtok in, $15/Mtok out): ~$3-5 total.

Usage:
  ANTHROPIC_API_KEY=sk-ant-... python3 scripts/02_paraphrase_claude.py
  python3 scripts/02_paraphrase_claude.py --dry-run

Output: data/paraphrased.jsonl
"""
from __future__ import annotations
import argparse
import json
import os
import re
import sys
import time
from collections import defaultdict
from pathlib import Path

try:
    from anthropic import Anthropic
except ImportError:
    print("pip install anthropic", file=sys.stderr); sys.exit(1)

ROOT = Path(__file__).resolve().parent.parent
SEED_PATH = ROOT / "data" / "seed.jsonl"
OUT_PATH = ROOT / "data" / "paraphrased.jsonl"
LOG_PATH = ROOT / "data" / "paraphrase.log"

MODEL = "claude-sonnet-4-5"
DEFAULT_N = 8

SYSTEM = """You rewrite questions about a federal contracts/grants database.
For each seed question, produce N alternative phrasings that the SAME SQL would answer.

Vary:
- Tone (terse, verbose, business-formal, casual, fragment).
- Structure (question, command, statement of need).
- Entity references ("CDC" / "Centers for Disease Control" / "the CDC" / "Centers for Disease Control and Prevention").
- Time references when natural ("last year", "in FY24", "since 2020" — only if the SQL uses time).
- Add realistic typos/abbreviations to ~1 in 8 phrasings to mimic real users.

Hard rules:
- The same SQL must answer ALL your phrasings. Do not change scope or filters.
- Output ONLY a JSON array of strings, no prose, no code fences."""

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
    arr = json.loads(text)
    return arr if isinstance(arr, list) else []

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--n-per", type=int, default=DEFAULT_N)
    ap.add_argument("--limit", type=int, default=0, help="cap how many seeds to process (0=all)")
    args = ap.parse_args()

    if not args.dry_run and not os.environ.get("ANTHROPIC_API_KEY"):
        print("Set ANTHROPIC_API_KEY", file=sys.stderr); return 1

    seeds = [json.loads(l) for l in SEED_PATH.read_text().splitlines() if l.strip()]
    if args.limit: seeds = seeds[:args.limit]
    LOG_PATH.unlink(missing_ok=True)
    OUT_PATH.unlink(missing_ok=True)
    log(f"start: {len(seeds)} seeds × {args.n_per} paraphrases each")

    if args.dry_run:
        log(f"DRY: would emit ~{len(seeds) * args.n_per} pairs"); return 0

    client = Anthropic()
    out = []
    for i, p in enumerate(seeds, 1):
        prompt = (
            f"Generate exactly {args.n_per} alternative phrasings.\n\n"
            f"SEED QUESTION: {p['question']}\n"
            f"SQL (must answer all your phrasings, do not change): {p['sql']}\n\n"
            f"Return a JSON array of {args.n_per} strings."
        )
        try:
            resp = client.messages.create(
                model=MODEL, max_tokens=1500, system=SYSTEM,
                messages=[{"role": "user", "content": prompt}],
            )
            arr = extract_json_array(resp.content[0].text)
            for q in arr[:args.n_per]:
                if isinstance(q, str) and q.strip():
                    out.append({
                        "category":   p["category"],
                        "difficulty": p["difficulty"],
                        "question":   q.strip(),
                        "sql":        p["sql"],
                        "row_count":  p.get("row_count"),
                        "source":     "paraphrase",
                        "seed_q":     p["question"],
                    })
            if i % 10 == 0:
                log(f"  {i}/{len(seeds)} seeds processed, {len(out)} paraphrases so far")
        except Exception as e:
            log(f"  seed {i} ERROR: {e}")

    OUT_PATH.write_text("\n".join(json.dumps(r) for r in out) + "\n")
    log(f"DONE: wrote {len(out)} paraphrases → {OUT_PATH}")

    by_cat: dict[str, int] = defaultdict(int)
    for r in out: by_cat[r["category"]] += 1
    log("by category:")
    for cat, n in sorted(by_cat.items(), key=lambda x: -x[1]):
        log(f"  {n:4d}  {cat}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
