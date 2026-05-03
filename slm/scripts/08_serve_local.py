"""
Local FastAPI server for the fine-tuned model.

POST /sql with {"question": "..."}
Returns {"sql": "...", "rows": [...], "error": null | str}

For experimentation only — when you're happy with quality, push the LoRA
adapter to Cloudflare Workers AI (see scripts/09_upload_workers_ai.md).

Run:
  pip install fastapi uvicorn
  python3 scripts/08_serve_local.py
  curl -s localhost:8765/sql -d '{"question":"top 5 vendors at NIH"}' -H 'Content-Type: application/json'
"""
from __future__ import annotations
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
SCHEMA = ROOT / "data" / "schema_compact.txt"
DB = ROOT / "data" / "awards-warehouse.db"
ADAPTER = ROOT / "out" / "llama31-8b-awards-sql"
BASE_MODEL = "meta-llama/Llama-3.1-8B-Instruct"

SYSTEM_TMPL = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query. Do not include explanation or fences — just SQL ending with semicolon.

SCHEMA:
{schema}"""

def extract_sql(text: str) -> str:
    text = text.strip()
    m = re.search(r"```(?:sql)?\s*(.*?)```", text, re.DOTALL | re.IGNORECASE)
    if m: text = m.group(1)
    m = re.match(r"\s*(.*?;)", text, re.DOTALL)
    if m: text = m.group(1)
    return text.strip()

def main() -> None:
    import torch
    from fastapi import FastAPI
    from pydantic import BaseModel
    from transformers import AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig
    from peft import PeftModel
    import uvicorn

    schema = SCHEMA.read_text()
    sys_msg = SYSTEM_TMPL.format(schema=schema)

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
    print("model loaded")

    db = sqlite3.connect(DB, check_same_thread=False)

    app = FastAPI()

    class Q(BaseModel):
        question: str
        execute: bool = True
        max_rows: int = 50

    @app.post("/sql")
    def sql(q: Q):
        msgs = [
            {"role": "system", "content": sys_msg},
            {"role": "user",   "content": q.question},
        ]
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=True)
        ids = tok(text, return_tensors="pt").to(model.device)
        with torch.no_grad():
            out = model.generate(
                **ids, max_new_tokens=400, do_sample=False, temperature=0.0,
                pad_token_id=tok.eos_token_id,
            )
        gen = tok.decode(out[0][ids.input_ids.shape[1]:], skip_special_tokens=True)
        pred = extract_sql(gen)
        result: dict = {"sql": pred, "rows": None, "error": None}
        if q.execute:
            try:
                cur = db.cursor()
                cur.execute(pred)
                cols = [d[0] for d in cur.description] if cur.description else []
                rows = cur.fetchmany(q.max_rows)
                result["rows"] = [dict(zip(cols, r)) for r in rows]
            except sqlite3.Error as e:
                result["error"] = str(e)
        return result

    @app.get("/")
    def root(): return {"ok": True, "model": "llama31-8b-awards-sql (LoRA)"}

    uvicorn.run(app, host="0.0.0.0", port=8765)

if __name__ == "__main__":
    main()
