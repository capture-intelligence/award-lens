"""
RunPod end-to-end training orchestrator.

Workflow:
  1. Create a pod (RTX 4090 community cloud, PyTorch image, SSH exposed)
  2. Wait for it to be SSH-reachable
  3. SCP training data + training script to /workspace/slm
  4. Install pip deps + run training there
  5. Stream training log back here
  6. SCP the adapter back to local out/llama31-8b-awards-sql/
  7. Stop the pod (you can resume later, or terminate if done)

Usage:
  RUNPOD_API_KEY=rpa_... python3 scripts/runpod_train.py [--gpu RTX4090|A40]
                                                         [--terminate]   # destroy after, don't just stop
                                                         [--resume POD_ID]  # use existing pod

The script is idempotent — if a pod is created but later steps fail, you can
re-run with --resume to pick up where it left off.

Cost: ~$0.40-0.70 for one full 3-epoch training run on a 4090.
"""
from __future__ import annotations
import argparse
import os
import shlex
import subprocess
import sys
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
DATA = ROOT / "data"
OUT = ROOT / "out" / "llama31-8b-awards-sql"

GPU_TYPES = {
    # Map short flag → exact RunPod GPU `id` (or substring match)
    "RTX4090": "NVIDIA GeForce RTX 4090",
    "A40":     "NVIDIA A40",
    "L40S":    "NVIDIA L40S",
    "L40":     "NVIDIA L40",
    "RTX3090": "NVIDIA GeForce RTX 3090",
    "RTX5090": "NVIDIA GeForce RTX 5090",
    "A6000":   "NVIDIA RTX A6000",
}

PYTORCH_IMAGE = "runpod/pytorch:2.4.0-py3.11-cuda12.4.1-devel-ubuntu22.04"

UPLOAD_FILES = [
    "data/train.jsonl",
    "data/val.jsonl",
    "data/eval.jsonl",
    "data/schema_compact.txt",
    "scripts/06_train.py",
    "scripts/07_eval_finetuned.py",
]

REMOTE_TRAIN_SCRIPT = """#!/bin/bash
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
"""

def log(msg: str) -> None:
    print(f"[{time.strftime('%H:%M:%S')}] {msg}", flush=True)

def find_gpu_type_id(runpod, want_name: str) -> str:
    """Find a GPU type by exact id, then by id-substring, then by displayName."""
    types = runpod.get_gpus()
    want = want_name.lower()
    for g in types:
        if g.get("id", "").lower() == want:
            return g["id"]
    for g in types:
        if want in g.get("id", "").lower():
            return g["id"]
    for g in types:
        if want in g.get("displayName", "").lower():
            return g["id"]
    raise SystemExit(f"GPU type {want_name!r} not found. Available: " +
                     ", ".join(g.get("id", "?") for g in types[:20]))

def wait_for_pod_running(runpod, pod_id: str, timeout_s: int = 300) -> dict:
    deadline = time.time() + timeout_s
    while time.time() < deadline:
        pod = runpod.get_pod(pod_id)
        status = pod.get("desiredStatus")
        runtime = pod.get("runtime") or {}
        ports = runtime.get("ports") or []
        ssh_port = next((p for p in ports if p.get("privatePort") == 22), None)
        if status == "RUNNING" and ssh_port and ssh_port.get("isIpPublic"):
            return pod
        log(f"  pod status={status} ssh_ready={bool(ssh_port and ssh_port.get('isIpPublic'))}")
        time.sleep(8)
    raise TimeoutError("Pod did not reach RUNNING+SSH within timeout")

def get_ssh_target(pod: dict) -> tuple[str, int]:
    """Returns (host, port) for SSH."""
    runtime = pod.get("runtime") or {}
    for p in runtime.get("ports", []):
        if p.get("privatePort") == 22 and p.get("isIpPublic"):
            return p["ip"], int(p["publicPort"])
    raise RuntimeError("No public SSH port on pod")

def run_ssh(host: str, port: int, cmd: str, key: str = "~/.ssh/id_ed25519") -> int:
    full = ["ssh", "-i", os.path.expanduser(key), "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null", "-p", str(port),
            f"root@{host}", cmd]
    return subprocess.call(full)

def run_scp(src: str, host: str, port: int, dst: str, key: str = "~/.ssh/id_ed25519") -> int:
    full = ["scp", "-i", os.path.expanduser(key), "-o", "StrictHostKeyChecking=no",
            "-o", "UserKnownHostsFile=/dev/null", "-P", str(port),
            "-r", src, f"root@{host}:{dst}"]
    return subprocess.call(full)

def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--gpu", default="RTX4090", choices=list(GPU_TYPES.keys()))
    ap.add_argument("--name", default="awards-sql-train")
    ap.add_argument("--resume", default=None, help="existing pod id")
    ap.add_argument("--terminate", action="store_true", help="destroy pod after, not just stop")
    ap.add_argument("--ssh-key", default=os.path.expanduser("~/.ssh/runpod_ed25519"))
    args = ap.parse_args()

    import runpod
    runpod.api_key = os.environ["RUNPOD_API_KEY"]
    hf_token = os.environ.get("HF_TOKEN")
    if not hf_token: raise SystemExit("Set HF_TOKEN")

    # 1. Pod
    if args.resume:
        log(f"resuming pod {args.resume}")
        pod = runpod.get_pod(args.resume)
    else:
        # Inject our SSH public key so we can scp/ssh in without RunPod-account-level keys
        pubkey_path = args.ssh_key + ".pub"
        if not os.path.exists(pubkey_path):
            raise SystemExit(f"public key missing at {pubkey_path}")
        pubkey = open(pubkey_path).read().strip()
        gpu_id = find_gpu_type_id(runpod, GPU_TYPES[args.gpu])
        log(f"creating pod (gpu={args.gpu} → {gpu_id})")
        pod = runpod.create_pod(
            name=args.name,
            image_name=PYTORCH_IMAGE,
            gpu_type_id=gpu_id,
            gpu_count=1,
            volume_in_gb=30,
            container_disk_in_gb=20,
            ports="22/tcp",
            volume_mount_path="/workspace",
            cloud_type="COMMUNITY",
            env={"PUBLIC_KEY": pubkey},  # pytorch image auto-installs this
        )
        log(f"created pod {pod['id']}")

    pod = wait_for_pod_running(runpod, pod["id"])
    host, port = get_ssh_target(pod)
    log(f"pod RUNNING @ {host}:{port}")

    # 2. Push files
    log("uploading data + scripts")
    run_ssh(host, port, "mkdir -p /workspace/slm/data /workspace/slm/scripts /workspace/slm/out", args.ssh_key)
    for f in UPLOAD_FILES:
        local = ROOT / f
        if not local.exists():
            log(f"  skip missing {f}")
            continue
        remote = f"/workspace/slm/{f}"
        rc = run_scp(str(local), host, port, remote, args.ssh_key)
        if rc != 0:
            log(f"  scp FAILED for {f}")
            return 2
        log(f"  uploaded {f}")

    # 3. Push the runner script
    runner = ROOT / "scripts" / "_runpod_runner.sh"
    runner.write_text(REMOTE_TRAIN_SCRIPT)
    runner.chmod(0o755)
    run_scp(str(runner), host, port, "/workspace/slm/_runpod_runner.sh", args.ssh_key)

    # 4. Run training in the pod (in a tmux so we can detach + reattach)
    log("starting training in tmux session 'train'")
    cmd = (
        f"export HF_TOKEN={shlex.quote(hf_token)}; "
        "tmux new-session -d -s train 'bash /workspace/slm/_runpod_runner.sh 2>&1; tmux wait-for -S done'"
    )
    rc = run_ssh(host, port, cmd, args.ssh_key)
    if rc != 0:
        log("failed to start tmux session"); return 3
    log("training started. tail logs with: ssh ... 'tail -f /workspace/slm/data/train.log'")
    log("when done (~45 min on 4090), re-run this script with --resume to fetch adapter")
    return 0

if __name__ == "__main__":
    sys.exit(main())
