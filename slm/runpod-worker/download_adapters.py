"""
Run once at Docker build time (or container startup if not baked in).
Downloads M1 + M2 LoRA adapters from HuggingFace to /adapters/.
Requires HF_TOKEN env var with read access to algocrat private repos.
"""
import os
from huggingface_hub import snapshot_download

HF_TOKEN = os.environ["HF_TOKEN"]

ADAPTERS = [
    ("algocrat/awards-sql-lora",       "/adapters/m1"),
    ("algocrat/awards-summarize-lora", "/adapters/m2"),
]

for repo_id, local_dir in ADAPTERS:
    print(f"Downloading {repo_id} → {local_dir} ...")
    snapshot_download(
        repo_id=repo_id,
        local_dir=local_dir,
        token=HF_TOKEN,
        ignore_patterns=["*.md", ".gitattributes"],
    )
    print(f"  done.")
