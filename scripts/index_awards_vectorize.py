"""
Embed all awards and upsert to Vectorize for semantic similarity search.

Uses Cloudflare REST APIs directly (no Worker needed):
  - D1 API  → fetch awards in batches
  - AI API  → embed descriptions with @cf/baai/bge-base-en-v1.5 (768-dim)
  - Vectorize API → upsert vectors with award metadata

Usage:
  python scripts/index_awards_vectorize.py
  python scripts/index_awards_vectorize.py --check   # show index stats only
  python scripts/index_awards_vectorize.py --batch 50  # smaller batches if rate-limited

Idempotent — re-running upserts are safe (vectors are keyed by award_id).
"""
from __future__ import annotations
import argparse
import json
import os
import sys
import time
from pathlib import Path

import requests

ACCOUNT_ID  = "f91a8ed8d60f3830e1821866fa2857e5"
DATABASE_ID = "c3aec4e5-f052-4deb-94f8-9625337d8e94"
INDEX_NAME  = "awardlens-awards"

CF_BASE     = f"https://api.cloudflare.com/client/v4/accounts/{ACCOUNT_ID}"
AI_ENDPOINT = f"{CF_BASE}/ai/run/@cf/baai/bge-base-en-v1.5"
D1_ENDPOINT = f"{CF_BASE}/d1/database/{DATABASE_ID}/query"
VEC_UPSERT  = f"{CF_BASE}/vectorize/v2/indexes/{INDEX_NAME}/upsert"
VEC_INFO    = f"{CF_BASE}/vectorize/v2/indexes/{INDEX_NAME}"


def load_cf_token() -> str:
    # Try env first, then .env file next to this script's repo root
    token = os.environ.get("CLOUDFLARE_API_TOKEN")
    if token:
        return token
    env_path = Path(__file__).resolve().parent.parent / ".env"
    if env_path.exists():
        for line in env_path.read_text().splitlines():
            if line.startswith("CLOUDFLARE_API_TOKEN="):
                return line.split("=", 1)[1].strip()
    raise RuntimeError(
        "CLOUDFLARE_API_TOKEN not found. Set it in .env or as an environment variable."
    )


def cf_headers(token: str) -> dict:
    return {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}


def d1_query(token: str, sql: str, params: list | None = None) -> list[dict]:
    body: dict = {"sql": sql}
    if params:
        body["params"] = params
    r = requests.post(D1_ENDPOINT, headers=cf_headers(token), json=body, timeout=30)
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"D1 error: {data}")
    return data["result"][0].get("results", [])


def embed_texts(token: str, texts: list[str]) -> list[list[float]]:
    """Embed a batch of texts. Returns list of 768-dim vectors."""
    r = requests.post(
        AI_ENDPOINT,
        headers=cf_headers(token),
        json={"text": texts},
        timeout=60,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"AI embed error: {data}")
    return data["result"]["data"]  # list of float lists


def upsert_vectors(token: str, vectors: list[dict]) -> dict:
    """
    vectors: list of {id: str, values: list[float], metadata: dict}
    Vectorize upsert accepts NDJSON.
    """
    ndjson = "\n".join(json.dumps(v) for v in vectors)
    r = requests.post(
        VEC_UPSERT,
        headers={**cf_headers(token), "Content-Type": "application/x-ndjson"},
        data=ndjson.encode(),
        timeout=120,
    )
    r.raise_for_status()
    data = r.json()
    if not data.get("success"):
        raise RuntimeError(f"Vectorize upsert error: {data}")
    return data["result"]


def build_embed_text(row: dict) -> str:
    """Combine fields into a single string for embedding."""
    parts = []
    if row.get("description"):
        parts.append(row["description"])
    if row.get("description_long"):
        parts.append(row["description_long"][:500])
    if row.get("naics_description"):
        parts.append(f"NAICS: {row['naics_description']}")
    if row.get("psc_description"):
        parts.append(f"PSC: {row['psc_description']}")
    return " | ".join(parts)[:2000]  # BGE handles up to ~512 tokens; 2000 chars is safe


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--check",  action="store_true", help="Show index stats and exit")
    ap.add_argument("--batch",  type=int, default=100, help="Awards per embedding batch (default 100)")
    args = ap.parse_args()

    token = load_cf_token()

    # Index stats
    r = requests.get(VEC_INFO, headers=cf_headers(token), timeout=15)
    r.raise_for_status()
    info = r.json().get("result", {})
    print(f"Index: {INDEX_NAME}  vectors: {info.get('vectorsCount', '?')}  dims: {info.get('config', {}).get('dimensions', '?')}")

    if args.check:
        return 0

    # Fetch all awards with NAICS + PSC descriptions joined
    print("Fetching awards from D1 ...")
    rows = d1_query(token, """
        SELECT
            a.award_id,
            a.description,
            a.description_long,
            a.naics_code,
            a.psc_code,
            nc.description  AS naics_description,
            pc.description  AS psc_description,
            a.award_type,
            a.current_value
        FROM award a
        LEFT JOIN naics_code nc ON nc.naics_code = a.naics_code
        LEFT JOIN psc_code   pc ON pc.psc_code   = a.psc_code
        WHERE a.description IS NOT NULL AND a.description != ''
    """)
    print(f"  {len(rows)} awards to embed")

    # Process in batches
    total_upserted = 0
    batch_size = args.batch
    for i in range(0, len(rows), batch_size):
        batch = rows[i : i + batch_size]
        texts = [build_embed_text(r) for r in batch]

        # Embed
        try:
            embeddings = embed_texts(token, texts)
        except Exception as e:
            print(f"  [warn] embed batch {i}-{i+batch_size} failed: {e}, retrying once ...")
            time.sleep(5)
            embeddings = embed_texts(token, texts)

        # Build vector objects
        vectors = []
        for row, vec in zip(batch, embeddings):
            vectors.append({
                "id": row["award_id"],
                "values": vec,
                "metadata": {
                    "naics_code":  row.get("naics_code") or "",
                    "psc_code":    row.get("psc_code") or "",
                    "award_type":  row.get("award_type") or "",
                    "current_value": float(row.get("current_value") or 0),
                },
            })

        # Upsert
        result = upsert_vectors(token, vectors)
        total_upserted += result.get("count", len(vectors))
        pct = int((i + len(batch)) / len(rows) * 100)
        print(f"  [{pct:3d}%] upserted {total_upserted} vectors so far")

        # Polite rate limiting
        time.sleep(0.5)

    print(f"\nDone. {total_upserted} vectors indexed in '{INDEX_NAME}'.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
