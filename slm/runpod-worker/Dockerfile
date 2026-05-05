FROM runpod/base:0.6.2-cuda12.1.0

# System deps
RUN apt-get update && apt-get install -y git && rm -rf /var/lib/apt/lists/*

# Python deps
RUN pip install --no-cache-dir \
    vllm==0.6.6.post1 \
    runpod==1.7.9 \
    huggingface_hub==0.26.5 \
    hf_transfer

# Download LoRA adapters from HuggingFace at build time.
# HF_TOKEN must be passed as a build arg (never baked into the image layer).
ARG HF_TOKEN
ENV HF_TOKEN=${HF_TOKEN}
ENV HF_HUB_ENABLE_HF_TRANSFER=1

RUN python -c "\
from huggingface_hub import snapshot_download; \
import os; \
token = os.environ['HF_TOKEN']; \
snapshot_download('algocrat/awards-sql-lora',       local_dir='/adapters/m1', token=token, ignore_patterns=['*.md','.gitattributes']); \
snapshot_download('algocrat/awards-summarize-lora', local_dir='/adapters/m2', token=token, ignore_patterns=['*.md','.gitattributes']); \
print('adapters downloaded')"

# Clear token from environment after build
ENV HF_TOKEN=""

COPY handler.py /app/handler.py
WORKDIR /app

CMD ["python", "handler.py"]
