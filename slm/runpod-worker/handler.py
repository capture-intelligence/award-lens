"""
RunPod Serverless handler for awards SLM.
Serves both M1 (SQL) and M2 (summarizer) LoRA adapters on one vLLM instance.

Request format:
  {
    "input": {
      "messages": [{"role": "system", "content": "..."}, {"role": "user", "content": "..."}],
      "adapter": "m1" | "m2",        # which LoRA to use
      "max_tokens": 400,
      "temperature": 0.0
    }
  }

Response format (RunPod standard):
  { "output": { "text": "..." } }
  { "error": "..." }
"""

import os
import runpod
from vllm import LLM, SamplingParams
from vllm.lora.request import LoRARequest

# ── Model + adapter IDs ────────────────────────────────────────────────────
BASE_MODEL = "meta-llama/Llama-3.1-8B-Instruct"
M1_REPO    = "algocrat/awards-sql-lora"
M2_REPO    = "algocrat/awards-summarize-lora"

# Local paths after download
M1_PATH = "/adapters/m1"
M2_PATH = "/adapters/m2"

LORA_REQUESTS = {
    "m1": LoRARequest("m1", 1, M1_PATH),
    "m2": LoRARequest("m2", 2, M2_PATH),
}

# ── Load model once at startup ─────────────────────────────────────────────
print("Loading base model + LoRA adapters ...")
llm = LLM(
    model=BASE_MODEL,
    enable_lora=True,
    max_lora_rank=16,
    max_model_len=4096,
    gpu_memory_utilization=0.90,
    dtype="bfloat16",
)
print("Model ready.")


def apply_chat_template(messages: list[dict]) -> str:
    """Convert messages list to Llama-3 instruct format."""
    parts = ["<|begin_of_text|>"]
    for msg in messages:
        role    = msg.get("role", "user")
        content = msg.get("content", "")
        parts.append(f"<|start_header_id|>{role}<|end_header_id|>\n\n{content}<|eot_id|>")
    parts.append("<|start_header_id|>assistant<|end_header_id|>\n\n")
    return "".join(parts)


def handler(job: dict) -> dict:
    inp = job.get("input", {})

    messages    = inp.get("messages", [])
    adapter_key = inp.get("adapter", "m1")
    max_tokens  = int(inp.get("max_tokens", 400))
    temperature = float(inp.get("temperature", 0.0))

    if not messages:
        return {"error": "messages required"}

    if adapter_key not in LORA_REQUESTS:
        return {"error": f"unknown adapter '{adapter_key}', use 'm1' or 'm2'"}

    prompt = apply_chat_template(messages)
    params = SamplingParams(
        temperature=temperature,
        max_tokens=max_tokens,
        stop=["<|eot_id|>", "<|end_of_text|>"],
    )

    outputs = llm.generate(
        [prompt],
        sampling_params=params,
        lora_request=LORA_REQUESTS[adapter_key],
    )

    text = outputs[0].outputs[0].text.strip()
    return {"output": {"text": text}}


if __name__ == "__main__":
    runpod.serverless.start({"handler": handler})
