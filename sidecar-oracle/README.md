# Oracle Cloud Always-Free Sidecar

A Node.js service that runs on an Oracle Always-Free VM, fetches USAspending data from the VM's IP (which isn't in Cloudflare's blocked ranges), and POSTs pages to the Cloudflare `api-worker` for upsert.

**Cost: $0 forever.** Oracle's Always Free tier includes the resources needed — the entry conditions don't expire.

## Architecture recap

```
systemd timer (daily 06:00 UTC)
        ↓
awards-sidecar.service (oneshot)
        ↓
ingest-usaspending.mjs
   1. Fetches api.usaspending.gov/search/spending_by_award/
      (from Oracle VM's IP — not blocked)
   2. Normalizes and pages
   3. POSTs each page with Bearer <INGEST_TOKEN> to
      api-worker.<sub>.workers.dev/import/awards
        ↓
api-worker (Cloudflare)
   Normalizes + upserts to D1
        ↓
Dashboard sees new data immediately.
```

---

## Prerequisites

- **A free Oracle Cloud account** — sign up at https://www.oracle.com/cloud/free/
  - You'll need a credit card for identity verification (never charged on Always Free)
  - Some regions have stricter VM availability; if creation fails, retry or pick a different availability domain
- **An SSH key pair** (Oracle will prompt you for the public key when launching)
- **The `INGEST_TOKEN` shared secret** already set as a Cloudflare Worker secret
  (see step 0 below if not)

---

## Step 0 — Set the INGEST_TOKEN shared secret (one-time, on your machine)

Generate a strong 64-hex-char token using whatever is available on your machine:

**PowerShell (Windows):**
```powershell
$bytes = [byte[]]::new(32)
[System.Security.Cryptography.RandomNumberGenerator]::Create().GetBytes($bytes)
-join ($bytes | ForEach-Object { '{0:x2}' -f $_ })
```

**Node (any OS, already installed):**
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

**OpenSSL (Git Bash, Linux, macOS):**
```bash
openssl rand -hex 32
```

Copy the output — this is your `INGEST_TOKEN`. Then register it with the Worker:

```powershell
# PowerShell (paste your token when prompted, or pipe it)
cd C:/Users/Tejas/past-awards-dashboard/workers/api
$token = "<paste-your-64-hex-char-token-here>"
$token | npx wrangler secret put INGEST_TOKEN
npx wrangler deploy
```

You'll paste the same token into the VM's `.env` in step 4.

---

## Step 1 — Launch the Oracle VM

In the OCI console:

1. **Navigation → Compute → Instances → Create Instance**
2. **Name:** `awards-sidecar`
3. **Image & shape:**
   - Image: **Canonical Ubuntu 22.04** (or **Oracle Linux 9**)
   - Shape: click **Change shape** → **Ampere** → **VM.Standard.A1.Flex**
     - OCPUs: **1** (free tier allows up to 4 total across all A1 instances)
     - Memory: **6 GB** (also within free tier)
   - (Alternative: `VM.Standard.E2.1.Micro` — simpler, x86, 1 OCPU, 1 GB, 2 instances always free)
4. **Networking:** Leave defaults. VCN + subnet auto-created. Assign public IPv4.
5. **SSH keys:** Paste your public key or let Oracle generate one and download it.
6. **Boot volume:** default 47 GB is fine.
7. Click **Create**. Wait 30-60 seconds for `PROVISIONING → RUNNING`.
8. **Note the public IP** on the instance detail page.

### Open outbound ports (usually not needed, but check)

Oracle's default VCN allows all outbound traffic. The sidecar only makes outbound HTTPS calls, so you should be fine. If outbound is restricted (corporate environments, etc.), open:

- TCP 443 outbound to `api.usaspending.gov`
- TCP 443 outbound to `api-worker.<sub>.workers.dev`

No inbound ports are needed beyond SSH (22).

---

## Step 2 — SSH in

```bash
ssh -i /path/to/your/private-key ubuntu@<PUBLIC_IP>
# Ubuntu default user is `ubuntu`; Oracle Linux default is `opc`
```

---

## Step 3 — Run the installer

```bash
curl -fsSL https://raw.githubusercontent.com/<you>/past-awards-dashboard/main/sidecar-oracle/install.sh \
  | REPO_URL=https://github.com/<you>/past-awards-dashboard.git bash
```

Or, if you already cloned the repo:

```bash
sudo git clone https://github.com/<you>/past-awards-dashboard.git /opt/awards-pipeline
bash /opt/awards-pipeline/sidecar-oracle/install.sh
```

The installer will:
1. Install Node.js 20
2. Create a service account `awards`
3. Clone the repo to `/opt/awards-pipeline`
4. Copy `env.example` → `.env`
5. Install and enable the systemd service + timer

---

## Step 4 — Edit the .env

```bash
sudo -u awards nano /opt/awards-pipeline/sidecar-oracle/.env
```

Minimal changes:

```
API_BASE=https://api-worker.algocrat.workers.dev
INGEST_TOKEN=<paste the same token from step 0>
AGENCIES=Department of Health and Human Services
MIN_VALUE=4000000
MAX_PAGES=10
```

Save and close.

---

## Step 5 — Test a run immediately (don't wait for the timer)

```bash
# Fire the service manually, one-shot
sudo systemctl start awards-sidecar.service

# Watch logs in real time
sudo journalctl -u awards-sidecar -f

# Or see the last run's full output
sudo journalctl -u awards-sidecar --since "5 minutes ago"
```

Expected output — one JSON object per line:

```json
{"ts":"2026-04-23T...","level":"info","msg":"sidecar start","api":"https://api-worker.algocrat.workers.dev","filters":{...}}
{"ts":"...","level":"info","msg":"page fetched","page":1,"count":100,"ms":812}
{"ts":"...","level":"info","msg":"page upserted","page":1,"run_id":42,"upserted":100,"failed":0}
...
{"ts":"...","level":"info","msg":"run complete","run_id":42,"total_upserted":500}
```

Verify the data landed by hitting the API worker from your laptop:

```bash
curl https://api-worker.algocrat.workers.dev/stats/overview
curl https://api-worker.algocrat.workers.dev/runs
```

---

## Step 6 — Confirm the daily timer

```bash
sudo systemctl list-timers awards-sidecar.timer
```

You should see something like:

```
NEXT                        LEFT   LAST  PASSED  UNIT                   ACTIVATES
Thu 2026-04-24 06:00:00 UTC 17h    -     -       awards-sidecar.timer   awards-sidecar.service
```

Done. From now on, it runs daily at 06:00 UTC with no human intervention.

---

## Operational tasks

### Change the schedule

Edit `/etc/systemd/system/awards-sidecar.timer` and update `OnCalendar=`. Then:

```bash
sudo systemctl daemon-reload
sudo systemctl restart awards-sidecar.timer
```

Examples:

- Every 2 hours: `OnCalendar=*-*-* 00/2:00:00 UTC`
- Weekdays at 06:00: `OnCalendar=Mon..Fri *-*-* 06:00:00 UTC`
- Every 15 min: `OnCalendar=*:00/15`

### Change filters

Edit `.env` and restart (no need for systemd reload — env is loaded per-run):

```bash
sudo -u awards nano /opt/awards-pipeline/sidecar-oracle/.env
sudo systemctl start awards-sidecar.service   # test immediately
```

### Add a second recipe (e.g., a different agency)

Copy the service and timer with new names:

```bash
sudo cp /etc/systemd/system/awards-sidecar.{service,service.backup}
# Create /opt/awards-pipeline/sidecar-oracle/.env.cdc with different filters
# Create /etc/systemd/system/awards-sidecar-cdc.service pointing to .env.cdc
# Create /etc/systemd/system/awards-sidecar-cdc.timer with a different schedule
sudo systemctl daemon-reload
sudo systemctl enable --now awards-sidecar-cdc.timer
```

### Upgrade to the latest repo version

```bash
cd /opt/awards-pipeline
sudo -u awards git pull
# Re-run installer in case systemd units changed
bash sidecar-oracle/install.sh
```

### Troubleshooting

| Symptom | Check |
|---|---|
| Timer not firing | `sudo systemctl list-timers` — is `awards-sidecar.timer` listed as active? |
| Service errors | `sudo journalctl -u awards-sidecar -n 200` |
| 401 from API worker | Token mismatch — verify `INGEST_TOKEN` in `.env` matches `wrangler secret list` on the Worker |
| 525 from USAspending | Oracle's IP range is blocked too (very unlikely) — try a different OCI region |
| "Address already in use" on port 22 | Someone else is SSH'd in — normal |
| VM reboots unexpectedly | Oracle occasionally reclaims idle always-free instances. `Persistent=true` on the timer means it'll catch up on next boot. |

---

## Security notes

- `INGEST_TOKEN` lives in `/opt/awards-pipeline/sidecar-oracle/.env`, readable only by the `awards` user (`chmod 600`).
- The service user has no shell (`/usr/sbin/nologin`), no sudo, no home directory outside `/opt/awards-pipeline`.
- `systemd` hardening flags: `NoNewPrivileges`, `ProtectSystem=strict`, `ProtectHome`, `PrivateTmp`.
- No inbound ports open. Only SSH (22) remains — lock it down to your IP in the OCI security list for extra safety.
- Node 20 security patches: `sudo apt upgrade nodejs` monthly, or enable unattended-upgrades.

---

## Why Oracle (vs. Lambda / Fly.io)

Picked for **zero recurring cost forever** with no credit-card surprises:

- Oracle Always Free: 4 Arm OCPUs + 24 GB RAM, 200 GB block storage, 10 TB egress/mo — stays free indefinitely
- AWS Lambda: free tier is generous but auto-expires after 12 months for new accounts in some SKUs
- Fly.io: free tier is solid but has been trimmed over the years

If you ever outgrow Oracle (hard — you won't), swap the systemd unit for a Lambda function; the script logic doesn't change.
