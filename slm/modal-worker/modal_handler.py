import os
import modal
from pydantic import BaseModel
from typing import List, Dict

app = modal.App("awards-slm-v2")

BASE_IMAGE = (
    modal.Image.debian_slim(python_version="3.11")
    .pip_install(
        "vllm==0.6.4.post1",
        "huggingface_hub>=0.24.0",
        "transformers>=4.44.0,<5.0.0",
    )
)

MODEL_ID = "meta-llama/Llama-3.1-8B-Instruct"
M1_REPO  = "algocrat/awards-sql-lora"
M2_REPO  = "algocrat/awards-summarize-lora"


def _download_models():
    """Runs at image build time — bakes model weights into the image layer."""
    from huggingface_hub import snapshot_download
    token = os.environ["HF_TOKEN"]
    snapshot_download(MODEL_ID, local_dir="/models/base", token=token)
    snapshot_download(M1_REPO,  local_dir="/adapters/m1", token=token)
    snapshot_download(M2_REPO,  local_dir="/adapters/m2", token=token)


image = BASE_IMAGE.run_function(
    _download_models,
    secrets=[modal.Secret.from_name("awards-slm-secrets")],
)


class InferBody(BaseModel):
    adapter: str = "m1"
    messages: List[Dict[str, str]] = []
    max_tokens: int = 400
    temperature: float = 0.0
    api_key: str = ""


@app.cls(
    image=image,
    gpu="A10G",
    secrets=[modal.Secret.from_name("awards-slm-secrets")],
    timeout=120,
    scaledown_window=300,
)
@modal.concurrent(max_inputs=4)
class Model:

    @modal.enter()
    def load(self):
        from vllm import LLM
        from vllm.lora.request import LoRARequest
        from transformers import AutoTokenizer

        self.tokenizer = AutoTokenizer.from_pretrained("/models/base")
        self.llm = LLM(
            model="/models/base",
            enable_lora=True,
            max_lora_rank=16,
            gpu_memory_utilization=0.90,
            max_model_len=4096,
            dtype="bfloat16",
        )
        self.lora = {
            "m1": LoRARequest("m1", 1, lora_path="/adapters/m1"),
            "m2": LoRARequest("m2", 2, lora_path="/adapters/m2"),
        }

    @modal.fastapi_endpoint(method="POST")
    def infer(self, body: InferBody) -> dict:
        from fastapi.responses import JSONResponse
        from vllm import SamplingParams

        expected = os.environ.get("MODAL_API_KEY", "")
        if expected and body.api_key != expected:
            return JSONResponse(status_code=401, content={"error": "Unauthorized"})

        prompt = self.tokenizer.apply_chat_template(
            body.messages, tokenize=False, add_generation_prompt=True
        )
        params   = SamplingParams(max_tokens=body.max_tokens, temperature=body.temperature)
        lora_req = self.lora.get(body.adapter, self.lora["m1"])
        outputs  = self.llm.generate([prompt], params, lora_request=lora_req)
        text     = outputs[0].outputs[0].text.strip()

        return {"output": {"text": text}}
