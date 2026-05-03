"""
QLoRA fine-tune of Llama-3.1-8B-Instruct on data/train.jsonl.

Hyperparameters chosen for two constraints:
  1. RTX 3060 12 GB — 4-bit base + small LoRA fits in ~9 GB.
  2. Cloudflare Workers AI BYO-LoRA — accepts adapters with:
       target_modules ⊆ {q_proj, k_proj, v_proj, o_proj}
       r ≤ 16,  alpha ≤ 32
     So we stay inside that envelope even though training would benefit from
     including gate/up/down projections.

Training format: chat-templated. The user message is the question; the
assistant message is the SQL. We mask the loss to only the assistant span
so the model learns to *generate* SQL, not just complete it.

Output:
  slm/out/llama31-8b-awards-sql/   — adapter weights, tokenizer, config
"""
from __future__ import annotations
import json
import os
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
TRAIN = ROOT / "data" / "train.jsonl"
VAL   = ROOT / "data" / "val.jsonl"
SCHEMA = ROOT / "data" / "schema_compact.txt"
OUT_DIR = ROOT / "out" / "llama31-8b-awards-sql"

BASE_MODEL = "Qwen/Qwen2.5-Coder-7B-Instruct"  # SQL-specialized base; not Workers-AI-serveable

SYSTEM = """You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query. Do not include explanation or fences — just SQL ending with semicolon.

SCHEMA:
{schema}"""

def load_jsonl(p: Path) -> list[dict]:
    return [json.loads(l) for l in p.read_text().splitlines() if l.strip()]

def main() -> int:
    import torch
    from datasets import Dataset
    from transformers import (
        AutoModelForCausalLM, AutoTokenizer, BitsAndBytesConfig,
        TrainingArguments,
    )
    from peft import LoraConfig, prepare_model_for_kbit_training, get_peft_model
    from trl import SFTTrainer, SFTConfig

    schema = SCHEMA.read_text()
    train = load_jsonl(TRAIN)
    val   = load_jsonl(VAL)
    print(f"train={len(train)} val={len(val)}")
    OUT_DIR.mkdir(parents=True, exist_ok=True)

    tok = AutoTokenizer.from_pretrained(BASE_MODEL)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token

    sys_msg = SYSTEM.format(schema=schema)

    def to_chat(p: dict) -> dict:
        msgs = [
            {"role": "system",    "content": sys_msg},
            {"role": "user",      "content": p["question"]},
            {"role": "assistant", "content": p["sql"]},
        ]
        text = tok.apply_chat_template(msgs, tokenize=False, add_generation_prompt=False)
        return {"text": text}

    train_ds = Dataset.from_list([to_chat(p) for p in train])
    val_ds   = Dataset.from_list([to_chat(p) for p in val])

    bnb = BitsAndBytesConfig(
        load_in_4bit=True, bnb_4bit_compute_dtype=torch.bfloat16,
        bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True,
    )
    model = AutoModelForCausalLM.from_pretrained(
        BASE_MODEL, quantization_config=bnb, device_map="auto", torch_dtype=torch.bfloat16,
    )
    # gradient_checkpointing=True saves ~10 GB of activation memory at the cost
    # of ~25% slowdown. Required to fit on a 24 GB card (4090). On the 3060
    # this combo deadlocked due to a consumer driver bug; on datacenter/4090
    # cards with proper drivers it works fine.
    model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)

    # No Workers AI constraints on Qwen — broader LoRA targets + higher rank
    # for more learning capacity. Empirically the MLP projections matter for
    # SQL pattern learning.
    lora_cfg = LoraConfig(
        r=32, lora_alpha=64, lora_dropout=0.05, bias="none",
        task_type="CAUSAL_LM",
        target_modules=["q_proj", "k_proj", "v_proj", "o_proj",
                        "gate_proj", "up_proj", "down_proj"],
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # ── Hyperparameter rationale ─────────────────────────────────────────
    # gradient_checkpointing=False — re-enabling it caused a futex hang at
    #   step 3 on the previous run (known bf16 + grad-accum race). We have
    #   memory headroom (peak ~7 GB at seq=1536 without checkpointing on a
    #   12 GB card), so we trade some VRAM for stability.
    # gradient_accumulation_steps=4 (was 8) — smaller accumulated state, less
    #   surface for a deadlock to land on.
    # logging_steps=5 (was 20) — denser progress so a real hang shows up
    #   inside 30 sec instead of inside 4 minutes.
    # max_steps overridden by --canary if running canary mode.
    # ── v2 hyperparameters ───────────────────────────────────────────────
    # v1 hit 15% exec accuracy with 3 epochs / lr=2e-4 / loss → 0.017 (severe
    # overfit). v2 changes:
    #   epochs:       3   →   1     (single pass, no memorization of training)
    #   lr:           2e-4 → 1e-4   (gentler updates)
    #   eval_steps:   epoch → 50    (catch overfit early)
    #   early stop:   no   → yes    (revert if val_loss climbs)
    canary = os.environ.get("TRAIN_CANARY", "0") == "1"
    sft_cfg = SFTConfig(
        output_dir=str(OUT_DIR),
        num_train_epochs=1,
        per_device_train_batch_size=2,    # 4090/A40 has headroom
        per_device_eval_batch_size=2,
        gradient_accumulation_steps=4,    # effective batch 8
        learning_rate=1e-4,
        lr_scheduler_type="cosine",
        warmup_ratio=0.05,
        weight_decay=0.01,
        logging_steps=10,
        save_strategy="steps" if not canary else "no",
        save_steps=50,
        save_total_limit=3,
        eval_strategy="steps" if not canary else "no",
        eval_steps=50,
        load_best_model_at_end=not canary,
        metric_for_best_model="eval_loss",
        greater_is_better=False,
        bf16=True,
        optim="paged_adamw_8bit",
        max_grad_norm=1.0,
        max_seq_length=1536,
        packing=False,
        gradient_checkpointing=True,
        dataloader_num_workers=0,
        report_to="none",
        dataset_text_field="text",
        max_steps=10 if canary else -1,
    )

    # Heartbeat: writes timestamp to data/train.heartbeat after every step.
    # External watchdog can `stat` this file; if mtime stalls > 5 min,
    # training is hung.
    HEARTBEAT = ROOT / "data" / "train.heartbeat"
    from transformers import TrainerCallback
    class HeartbeatCallback(TrainerCallback):
        def on_step_end(self, args, state, control, **kw):
            HEARTBEAT.write_text(f"{time.time()} step={state.global_step}\n")

    from transformers import EarlyStoppingCallback
    callbacks = [HeartbeatCallback()]
    if not canary:
        callbacks.append(EarlyStoppingCallback(
            early_stopping_patience=3,    # 3 evals without val_loss improvement → stop
            early_stopping_threshold=1e-3,
        ))

    trainer = SFTTrainer(
        model=model,
        train_dataset=train_ds,
        eval_dataset=val_ds,
        args=sft_cfg,
        tokenizer=tok,
        callbacks=callbacks,
    )
    trainer.train()
    trainer.save_model(str(OUT_DIR))
    tok.save_pretrained(str(OUT_DIR))
    print(f"\nSaved adapter to {OUT_DIR}")
    return 0

if __name__ == "__main__":
    sys.exit(main())
