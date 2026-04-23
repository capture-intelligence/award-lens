#!/usr/bin/env node
// =============================================================================
// Awards pipeline — one-shot bootstrap (cross-platform, Node-based).
//
// Works on Windows PowerShell, macOS Terminal, Linux bash — no shell deps.
// Idempotent. State cached in .bootstrap-state.json.
//
// Prereqs:
//   • Node 20+
//   • pnpm   (npm i -g pnpm)
//   • `npx wrangler login` already run
//   • workers/sam-api/.dev.vars has SAM_GOV_API_KEY=...
// =============================================================================

import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
process.chdir(ROOT);

const STATE_FILE  = join(ROOT, '.bootstrap-state.json');
const SAM_DEV_VARS = join(ROOT, 'workers', 'sam-api', '.dev.vars');

// ─── output helpers ──────────────────────────────────────────────────────────
const isTTY = process.stdout.isTTY;
const c = (code, s) => isTTY ? `\x1b[${code}m${s}\x1b[0m` : s;
const step = (m) => console.log('\n' + c(34, '▸ ' + m));
const ok   = (m) => console.log('  ' + c(32, '✓ ' + m));
const warn = (m) => console.log('  ' + c(33, '⚠ ' + m));
const note = (m) => console.log('  ' + c(90, m));
const die  = (m) => { console.error(c(31, '✗ ' + m)); process.exit(1); };

// ─── shell runner (works on win/mac/linux) ───────────────────────────────────
function run(cmd, { capture = false, input, cwd, allowFail = false } = {}) {
  const res = spawnSync(cmd, {
    shell: true,
    encoding: 'utf8',
    stdio: capture ? ['pipe', 'pipe', 'pipe'] : ['inherit', 'inherit', 'inherit'],
    cwd: cwd ?? ROOT,
    input,
    env: process.env,
  });
  if (res.error) {
    if (allowFail) return { code: 1, stdout: '', stderr: String(res.error) };
    die(`command failed: ${cmd}\n  ${res.error.message}`);
  }
  const out = { code: res.status ?? 0, stdout: res.stdout ?? '', stderr: res.stderr ?? '' };
  if (!allowFail && out.code !== 0 && !capture) {
    die(`command failed (${out.code}): ${cmd}`);
  }
  return out;
}

const wrangler = (args, opts = {}) => run(`npx --yes wrangler ${args}`, opts);

// ─── preflight ───────────────────────────────────────────────────────────────
step('Preflight');
if (run('node --version', { capture: true }).code !== 0) die('node not found');
if (run('pnpm --version', { capture: true }).code !== 0) die('pnpm not found — run: npm i -g pnpm');
const who = wrangler('whoami', { capture: true, allowFail: true });
if (who.code !== 0) die('not logged in — run: npx wrangler login');
ok('wrangler authenticated');

// ─── load prior state ────────────────────────────────────────────────────────
let state = { D1_ID: '', KV_ID: '' };
if (existsSync(STATE_FILE)) {
  try { state = JSON.parse(readFileSync(STATE_FILE, 'utf8')); }
  catch { /* ignore corrupt state — recreate */ }
}

// ─── install deps ────────────────────────────────────────────────────────────
step('Installing dependencies (pnpm install)');
run('pnpm install --silent');
ok('deps installed');

// ─── resource helpers ────────────────────────────────────────────────────────

// Handles BOTH `key = "val"` (TOML) AND `"key": "val"` (JSON).
// Wrangler versions differ: 3.x often emits JSON; older emits TOML snippets.
function parseId(text, key) {
  const m = new RegExp(`"?${key}"?\\s*[:=]\\s*"([^"]+)"`, 'i').exec(text);
  return m?.[1] ?? null;
}

// Strip any banner text before the first { or [ and JSON.parse the rest.
function tryParseJson(str) {
  if (!str) return null;
  const s = str.trim();
  let start = -1;
  for (let i = 0; i < s.length; i++) {
    if (s[i] === '{' || s[i] === '[') { start = i; break; }
  }
  if (start < 0) return null;
  try { return JSON.parse(s.slice(start)); } catch { return null; }
}

function findD1(name) {
  const out = wrangler('d1 list --json', { capture: true, allowFail: true });
  if (out.code !== 0) return null;
  const data = tryParseJson(out.stdout);
  const arr = Array.isArray(data) ? data : (data?.result ?? []);
  const match = arr.find(d => d.name === name);
  return match?.uuid ?? match?.id ?? null;
}

function findKV(binding) {
  const out = wrangler('kv namespace list', { capture: true, allowFail: true });
  if (out.code !== 0) return null;
  const data = tryParseJson(out.stdout);
  const arr = Array.isArray(data) ? data : (data?.result ?? []);
  const match = arr.find(n =>
    n.title === binding || n.title?.endsWith(`-${binding}`) || n.title?.endsWith(`_${binding}`),
  );
  return match?.id ?? null;
}

function ensureD1(name) {
  let id = findD1(name);
  if (id) return id;

  const out = wrangler(`d1 create ${name}`, { capture: true, allowFail: true });
  const combined = out.stdout + '\n' + out.stderr;

  // Parse ID from the create output (handles both JSON and TOML)
  id = parseId(combined, 'database_id');
  if (id) return id;

  // Fallback: wrangler created it but emitted a format we didn't match —
  // just look it up in the list again.
  id = findD1(name);
  if (id) return id;

  die(`could not create or resolve D1 database '${name}':\n${combined}`);
}

function ensureKV(binding) {
  let id = findKV(binding);
  if (id) return id;

  const out = wrangler(`kv namespace create ${binding}`, { capture: true, allowFail: true });
  const combined = out.stdout + '\n' + out.stderr;

  id = parseId(combined, 'id');
  if (id) return id;

  id = findKV(binding);
  if (id) return id;

  die(`could not create KV namespace '${binding}':\n${combined}`);
}

function ensureR2(name) {
  const out = wrangler(`r2 bucket create ${name}`, { capture: true, allowFail: true });
  const msg = out.stdout + out.stderr;
  if (out.code === 0) { ok(`R2 bucket created: ${name}`); return; }
  if (looksAlreadyExists(msg)) { note(`R2 bucket exists: ${name}`); return; }
  die(`r2 create failed:\n${msg}`);
}

function findQueue(name) {
  const out = wrangler('queues list --json', { capture: true, allowFail: true });
  if (out.code !== 0) return null;
  const data = tryParseJson(out.stdout);
  const arr = Array.isArray(data) ? data : (data?.result ?? []);
  const match = arr.find(q => q.queue_name === name || q.name === name);
  return match ? (match.queue_id ?? match.queue_name ?? match.name) : null;
}

// Matches the various "this already exists" phrasings Cloudflare APIs return
// across wrangler versions.
const ALREADY_EXISTS_PATTERNS = [
  /already exists/i,
  /already taken/i,           // wrangler 4.x queues
  /already owned/i,           // R2 buckets
  /AlreadyOwnedByYou/,         // R2 S3-style
  /\[code:\s*11009\]/,         // queue duplicate code
  /DuplicateName/i,
];
const looksAlreadyExists = (msg) => ALREADY_EXISTS_PATTERNS.some((r) => r.test(msg));

function ensureQueue(name) {
  // Pre-check: list first so we don't need to rely on error-message parsing.
  if (findQueue(name)) { note(`queue exists: ${name}`); return; }

  const out = wrangler(`queues create ${name}`, { capture: true, allowFail: true });
  const msg = out.stdout + out.stderr;
  if (out.code === 0) { ok(`queue created: ${name}`); return; }
  if (looksAlreadyExists(msg)) { note(`queue exists: ${name}`); return; }
  // "specified queue settings are invalid" is what the API returns when the
  // account lacks the Queues entitlement (i.e. no Workers Paid plan).
  if (/queue settings are invalid|entitlement|subscription/i.test(msg)) {
    die(
      `queue '${name}' could not be created.\n\n` +
      `  Cloudflare Queues requires the Workers Paid plan ($5/month).\n` +
      `  Upgrade at: https://dash.cloudflare.com → Workers & Pages → "Add Paid Plan"\n` +
      `  Then re-run: pnpm bootstrap\n\n` +
      `  Original error:\n${msg}`
    );
  }
  die(`queue create failed for ${name}:\n${msg}`);
}

// ─── create resources ────────────────────────────────────────────────────────
step('D1 database');
if (!state.D1_ID) state.D1_ID = ensureD1('awards-warehouse');
ok(`D1: ${state.D1_ID}`);

step('KV namespace');
if (!state.KV_ID) state.KV_ID = ensureKV('META');
ok(`KV: ${state.KV_ID}`);

step('R2 buckets');
ensureR2('awards-staging');

step('Queues');
for (const q of ['normalize-queue', 'upsert-queue', 'sam-enrich-queue', 'dlq']) {
  ensureQueue(q);
}

// ─── persist state ───────────────────────────────────────────────────────────
writeFileSync(STATE_FILE, JSON.stringify(state, null, 2));
ok(`state saved → ${STATE_FILE}`);

// ─── inject IDs into wrangler.toml files ─────────────────────────────────────
step('Wiring IDs into wrangler.toml files');
const TOMLS = [
  'workers/api/wrangler.toml',
  'workers/scheduler/wrangler.toml',
  'workers/usaspending-workflow/wrangler.toml',
  'workers/sam-bulk-workflow/wrangler.toml',
  'workers/grants-gov-workflow/wrangler.toml',
  'workers/sam-api/wrangler.toml',
  'workers/normalizer/wrangler.toml',
  'workers/upsert/wrangler.toml',
];
for (const rel of TOMLS) {
  const path = join(ROOT, rel);
  if (!existsSync(path)) continue;
  const orig = readFileSync(path, 'utf8');
  if (!/REPLACE_WITH_YOUR_(D1|KV)_ID/.test(orig)) {
    note(`${rel} (already wired)`);
    continue;
  }
  const updated = orig
    .replace(/REPLACE_WITH_YOUR_D1_ID/g, state.D1_ID)
    .replace(/REPLACE_WITH_YOUR_KV_ID/g, state.KV_ID);
  writeFileSync(path, updated);
  ok(rel);
}

// ─── apply D1 migrations ─────────────────────────────────────────────────────
step('Applying D1 migrations (remote)');
const mig = wrangler('d1 migrations apply awards-warehouse --remote', {
  cwd: join(ROOT, 'workers', 'api'),
  allowFail: true,
});
if (mig.code !== 0) warn('migrations returned non-zero (often means already up to date)');

// ─── deploy sam-api-worker FIRST ─────────────────────────────────────────────
step('Deploying sam-api-worker (dependency root)');
wrangler('deploy', { cwd: join(ROOT, 'workers', 'sam-api') });
ok('sam-api-worker deployed');

// ─── upload SAM_GOV_API_KEY secret ───────────────────────────────────────────
step('Uploading SAM_GOV_API_KEY secret');
if (!existsSync(SAM_DEV_VARS)) {
  warn(`${SAM_DEV_VARS} missing — skipping secret upload`);
} else {
  const devVars = readFileSync(SAM_DEV_VARS, 'utf8');
  const m = /^SAM_GOV_API_KEY\s*=\s*(.+)$/m.exec(devVars);
  if (!m) {
    warn('no SAM_GOV_API_KEY= line found — skipping');
  } else {
    const key = m[1].trim().replace(/^["']|["']$/g, '');
    const res = run('npx --yes wrangler secret put SAM_GOV_API_KEY', {
      cwd: join(ROOT, 'workers', 'sam-api'),
      capture: true,
      input: key + '\n',
      allowFail: true,
    });
    if (res.code === 0) {
      ok('secret uploaded');
    } else {
      warn('secret put returned non-zero:\n' + (res.stderr || res.stdout));
    }
  }
}

// ─── deploy remaining workers ────────────────────────────────────────────────
for (const w of [
  'usaspending-workflow',
  'sam-bulk-workflow',
  'grants-gov-workflow',
  'normalizer',
  'upsert',
  'scheduler',
  'api',
]) {
  step(`Deploying ${w}`);
  wrangler('deploy', { cwd: join(ROOT, 'workers', w) });
  ok(`${w} deployed`);
}

// ─── deploy web dashboard ────────────────────────────────────────────────────
step('Deploying web dashboard (Cloudflare Pages)');
const webInstall = run('pnpm install --silent', { cwd: join(ROOT, 'web'), allowFail: true });
if (webInstall.code !== 0) warn('pnpm install in web/ failed');
// Use `pnpm run deploy` (not `pnpm deploy`) — the latter is a pnpm built-in
// that tries to deploy a workspace package subset, not our user script.
const webDeploy = run('pnpm run deploy', { cwd: join(ROOT, 'web'), allowFail: true });
if (webDeploy.code !== 0) warn('pages deploy failed — retry manually: cd web && pnpm run deploy');

// ─── first-run kickoffs ──────────────────────────────────────────────────────
step('First-run kickoffs');
const sub = process.env.CF_WORKERS_SUBDOMAIN;
if (!sub) {
  note('set CF_WORKERS_SUBDOMAIN=<your-subdomain> to auto-fire trigger endpoints.');
  note('Meanwhile, run these manually:');
  console.log(`
    curl -X POST https://scheduler-worker.<sub>.workers.dev/trigger/backfill-toptier-codes
    curl -X POST https://scheduler-worker.<sub>.workers.dev/trigger/usaspending \\
      -H "content-type: application/json" -d '{"mode":"incremental"}'
    curl -X POST https://scheduler-worker.<sub>.workers.dev/trigger/sam-bulk \\
      -H "content-type: application/json" -d '{"extracts":["exclusions"]}'
`);
} else {
  const base = `https://scheduler-worker.${sub}.workers.dev`;
  const calls = [
    { label: 'toptier backfill', url: `${base}/trigger/backfill-toptier-codes`, body: '' },
    { label: 'usaspending incremental', url: `${base}/trigger/usaspending`, body: '{"mode":"incremental"}' },
    { label: 'sam bulk exclusions', url: `${base}/trigger/sam-bulk`, body: '{"extracts":["exclusions"]}' },
  ];
  for (const c of calls) {
    try {
      const res = await fetch(c.url, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: c.body || undefined,
      });
      const text = (await res.text()).slice(0, 300);
      ok(`${c.label}: ${res.status}  ${text}`);
    } catch (e) {
      warn(`${c.label} failed: ${e.message}`);
    }
  }
}

// ─── summary ─────────────────────────────────────────────────────────────────
console.log('\n' + c(32, '═'.repeat(60)));
console.log(c(32, '  Bootstrap complete'));
console.log(c(32, '═'.repeat(60)) + '\n');
console.log(`  Resource IDs cached in: ${STATE_FILE}`);
console.log('\n  Next checks (substitute your workers.dev subdomain):');
console.log('    • Overview:     GET  /stats/overview');
console.log('    • Schedule:     GET  /schedule/status');
console.log('    • SAM budget:   GET  /sam-api/status');
console.log('\n  Tail logs:');
console.log('    npx wrangler tail usaspending-workflow');
console.log('    npx wrangler tail sam-api-worker');
console.log();
