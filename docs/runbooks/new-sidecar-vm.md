# Spinning up a new Oracle Always-Free sidecar VM

Use this when:
- USAspending IP-banned the current VM and you need a fresh egress IP.
- You want to spread enrichment load across two sidecars.
- You're rotating off an old box.

End state: a fresh Ubuntu 22.04 VM that runs the same enrichment timers as the current one, accessible from the GitHub Actions Deploy workflow via the same `VM_HOST` / `VM_USER` / `VM_SSH_KEY` secrets.

Total time: **~20 min**.

---

## Step 1 — Create the VM in the Oracle Cloud console

1. Sign in to https://cloud.oracle.com
2. **Compute → Instances → Create Instance**
3. Settings:
   - **Name**: `awardlens-sidecar-2` (or whatever)
   - **Image**: Canonical Ubuntu 22.04 (latest LTS)
   - **Shape**: `VM.Standard.E2.1.Micro` (AMD, Always Free)
     - If unavailable in your region, use `VM.Standard.A1.Flex` with 1 OCPU / 1 GB RAM (ARM Ampere, Always Free)
   - **Networking**: leave default VCN, **enable public IPv4**
   - **SSH keys**: paste the public key whose private half lives in your GitHub Actions `VM_SSH_KEY` secret
4. **Create**. Wait for the instance state to flip to *Running* (~60s).
5. Copy the assigned public IPv4 address.

## Step 2 — SSH in and bootstrap

```bash
# from your laptop
ssh ubuntu@<NEW_VM_IP>

# on the VM
sudo apt-get update && sudo apt-get install -y git curl

# Clone the repo into /opt/awards-pipeline as ubuntu (NOT root —
# install.sh refuses to run as root because sudo+git can't see your
# SSH config).
ssh-keygen -t ed25519 -f ~/.ssh/github-awards -N "" -C "awardlens-sidecar-2"
cat ~/.ssh/github-awards.pub
# → Copy this output. In your laptop browser, add it as a deploy key:
#   gh repo deploy-key add ~/.ssh/github-awards.pub --repo Algocrat/past-awards-dashboard
# (or via the web UI: Settings → Deploy keys → Add)

cat >> ~/.ssh/config <<'EOF'
Host github.com
  IdentityFile ~/.ssh/github-awards
  IdentitiesOnly yes
  StrictHostKeyChecking accept-new
EOF
chmod 600 ~/.ssh/config

git clone git@github.com:Algocrat/past-awards-dashboard.git /tmp/awards
sudo mkdir -p /opt
sudo mv /tmp/awards /opt/awards-pipeline

bash /opt/awards-pipeline/sidecar-oracle/install.sh
```

## Step 3 — Configure `.env`

```bash
sudo -u awards nano /opt/awards-pipeline/sidecar-oracle/.env
```

Fill in:

```env
API_BASE=https://api-worker.<your-subdomain>.workers.dev
INGEST_TOKEN=<same secret as the existing VM uses; pull from the running VM if needed>
# Optional, defaults are fine:
# MAX_PAGES_PER_VIEW=100
# FALLBACK_LOOKBACK_MO=24
ENRICH_BATCH_SIZE=25            # <-- conservative for the new VM
ENRICH_PACE_MS=2500             # <-- 2.5s between awards to avoid USAspending re-banning
ENRICH_MAX_AGE_DAYS=90
```

The conservative `ENRICH_BATCH_SIZE=25` and `ENRICH_PACE_MS=2500` are deliberate — the previous VM hit a rate limit by going too fast. With these values, a backfill of 7K rows takes ~5 hours but won't trip the limit.

## Step 4 — Re-point GitHub Actions to the new VM

In your repo's **Settings → Secrets and variables → Actions**, update:

| Secret | New value |
|---|---|
| `VM_HOST` | `<NEW_VM_IP>` |
| `VM_USER` | `ubuntu` |
| `VM_SSH_KEY` | unchanged (assuming you used the same key in step 1) |

## Step 5 — Push current sidecar code via the Deploy workflow

Trigger any commit to `main` (or run `gh workflow run Deploy --ref main`). The Deploy workflow's `sidecar` job will scp the latest `*.mjs` and systemd units to the new VM, then enable all timers including the new `awards-enrich-descriptions.timer`.

## Step 6 — Smoke test

```bash
gh workflow run "Run description enrichment" --ref main -f mode=incremental
```

Watch the run. If you see a successful batch with `applied: N` for some N > 0, the new VM is working. If you see another `TypeError: fetch failed`, USAspending is range-banning all of Oracle Always-Free — pivot to the GitHub Actions runner fallback (see `enrich-on-actions.md`).

## Step 7 — Decommission the old VM (optional)

After confirming the new one works:

```bash
# On the OLD VM
sudo systemctl stop awards-enrich-descriptions.timer awards-sidecar.timer
sudo systemctl disable awards-enrich-descriptions.timer awards-sidecar.timer
```

Then in Oracle Cloud → **Compute → Instances → [old instance] → Stop / Terminate**.

---

## Recovering null-stamped rows

After enrichment is working again, run this once to clear any rows that got stamped during the failed runs (they have `description_enriched_at` set but `description_long` and `mod_history` are NULL):

```bash
INGEST_TOKEN=$(your token)
API_BASE=https://api-worker.<subdomain>.workers.dev

curl -X POST -H "Authorization: Bearer $INGEST_TOKEN" \
  "$API_BASE/sidecar/awards/reset-failed-enrichment?since=0"
# → { "reset": <count>, "since": 0 }
```

Those rows will re-enter the enrichment queue on the next sweep.

## Common gotchas

- **Oracle Always-Free shape unavailable**: rotate region, or use ARM Ampere (`VM.Standard.A1.Flex` 1 OCPU / 1 GB).
- **SSH refuses key** with the new VM: confirm you pasted the right *public* key during instance creation; Oracle adds it to `~ubuntu/.ssh/authorized_keys` automatically.
- **`install.sh` complains about repo permissions**: re-run as the same user that did `git clone`.
- **`fetch failed` immediately after setup**: probably the same USAspending range-ban hitting all Oracle IPs. Skip to the GitHub Actions runner fallback.
