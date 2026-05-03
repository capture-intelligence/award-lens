"""
Build a compact schema representation for the model prompt.

The full DDL is ~3000 tokens after Llama tokenization, which OOMs an RTX 3060
during LoRA training (8B + 4-bit + gradients + KV cache + seq=3000 won't fit
in 12 GB). The compact form keeps just the structural facts a text-to-SQL
model needs:

  table_name(col1 TYPE, col2 TYPE, ...)

Foreign keys collapsed to "→target_table". Constraints, defaults, and
formatting dropped. Internal/auth tables excluded (the SLM's job is to
answer business questions, not query its own session table).

Output: data/schema_compact.txt  (~700-900 tokens after Llama tokenization)
"""
from __future__ import annotations
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DB = ROOT / "data" / "awards-warehouse.db"
OUT = ROOT / "data" / "schema_compact.txt"

EXCLUDE = {
    "app_session", "app_user_audit", "d1_migrations", "sam_api_budget",
    "staging_raw_record", "data_filter", "data_view", "filter_access",
    "view_access", "view_run_request", "entity_tag", "taxonomy", "taxonomy_term",
    "external_id_mapping", "view_award", "vendor_classification",
    "organization_alias", "country", "source_system",
}

def parse_create_table(sql: str) -> tuple[str, list[tuple[str, str, str | None]]]:
    """Returns (table_name, [(col, type, fk_target_or_None), ...])."""
    m = re.match(r"CREATE TABLE\s+(\w+|\"\w+\")\s*\((.*)\)\s*$", sql, re.DOTALL | re.IGNORECASE)
    if not m: return "", []
    name = m.group(1).strip('"')
    body = m.group(2)
    cols = []
    # Split on top-level commas
    depth = 0
    cur = ""
    parts = []
    for ch in body:
        if ch == "(": depth += 1
        elif ch == ")": depth -= 1
        if ch == "," and depth == 0:
            parts.append(cur.strip()); cur = ""
        else:
            cur += ch
    if cur.strip(): parts.append(cur.strip())
    for p in parts:
        # Skip table-level constraints
        if re.match(r"^(PRIMARY|UNIQUE|FOREIGN|CHECK|CONSTRAINT)\s", p, re.IGNORECASE):
            continue
        m = re.match(r"^([\w]+)\s+(\w+)", p)
        if not m: continue
        col, typ = m.group(1), m.group(2)
        # Find FK target if any
        fk = None
        m2 = re.search(r"REFERENCES\s+(\w+)", p, re.IGNORECASE)
        if m2: fk = m2.group(1)
        cols.append((col, typ.upper(), fk))
    return name, cols

def main() -> None:
    conn = sqlite3.connect(DB)
    cur = conn.cursor()
    rows = cur.execute(
        "SELECT name, sql FROM sqlite_master WHERE type='table' "
        "AND name NOT LIKE 'sqlite_%' AND name NOT LIKE '_cf_%' ORDER BY name"
    ).fetchall()
    conn.close()

    lines = []
    for name, sql in rows:
        if name in EXCLUDE: continue
        if not sql: continue
        tbl, cols = parse_create_table(sql)
        if not tbl: continue
        # Keep type compact + show FK as →
        col_strs = []
        for c, t, fk in cols:
            t_short = {"INTEGER": "INT", "TEXT": "TXT", "REAL": "REAL"}.get(t, t)
            s = f"{c}:{t_short}"
            if fk: s += f"→{fk}"
            col_strs.append(s)
        lines.append(f"{tbl}({', '.join(col_strs)})")

    OUT.write_text("\n".join(lines) + "\n")
    print(f"wrote {OUT}")
    print(f"tables: {len(lines)}")
    print(f"size:   {OUT.stat().st_size} bytes")
    print()
    print("--- preview (first 5 tables) ---")
    for l in lines[:5]: print(l)

if __name__ == "__main__":
    main()
