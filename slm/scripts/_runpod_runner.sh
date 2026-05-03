#!/bin/bash
set -e
cd /workspace/slm
pip install -q -U transformers==4.46.0 peft==0.13.2 trl==0.12.0 datasets==3.1.0 accelerate==1.1.1 'bitsandbytes>=0.45.0' huggingface_hub
huggingface-cli login --token "$HF_TOKEN" 2>&1 | tail -2
mkdir -p data out
# 06_train.py expects ROOT/data and ROOT/out — symlink them
[ -d data ] || ln -s /workspace/slm/data data
echo "==== STARTING TRAINING ===="
python3 scripts/06_train.py 2>&1 | tee data/train.log
echo "==== STARTING EVAL ===="
python3 scripts/07_eval_finetuned.py 2>&1 | tee data/finetuned_eval.log
echo "==== DONE ===="
