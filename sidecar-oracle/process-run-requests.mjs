#!/usr/bin/env node
// =============================================================================
// Oracle Cloud sidecar — "Run now" request processor
//
// Polls /sidecar/run-requests every 60s (via a systemd timer), claims
// any pending request, ingests the requested view immediately, and reports
// success/failure back to the worker. The worker handles exponential
// backoff scheduling on failures.
//
// Reuses the same per-view ingest path as the master timer — by setting
// ONLY_VIEW=<view_id> and shelling out to ingest-usaspending.mjs we get
// identical behavior with no code duplication.
//
// Env (loaded via systemd EnvironmentFile = /etc/awards-sidecar.env):
//   API_BASE              required
//   INGEST_TOKEN          required
//   MAX_PAGES_PER_VIEW    optional, passed through to ingest script
//   FALLBACK_LOOKBACK_MO  optional, passed through
// =============================================================================

import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const env = process.env;
function require_env(name) {
  const v = env[name];
  if (!v) { console.error(`ERROR: env var ${name} is required`); process.exit(1); }
  return v;
}
const API   = require_env('API_BASE').replace(/\/$/, '');
const TOKEN = require_env('INGEST_TOKEN');

function log(level, msg, extra = {}) {
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));
}

async function api(method, path, body) {
  const res = await fetch(`${API}${path}`, {
    method,
    headers: {
      'content-type': 'application/json',
      authorization: `Bearer ${TOKEN}`,
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let parsed = null; try { parsed = text ? JSON.parse(text) : null; } catch { /* */ }
  if (!res.ok) {
    throw new Error(`${method} ${path} → ${res.status}: ${text.slice(0, 300)}`);
  }
  return parsed;
}

// Run the existing per-view ingest script with ONLY_VIEW set.
// Returns the run_id captured from logs (best-effort) plus exit-code success/fail.
function ingestSingleView(viewId) {
  return new Promise((resolveP) => {
    const __filename = fileURLToPath(import.meta.url);
    const here = dirname(__filename);
    const scriptPath = resolve(here, 'ingest-usaspending.mjs');

    const child = spawn(process.execPath, [scriptPath], {
      env: { ...env, ONLY_VIEW: viewId },
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let lastRunId = null;
    let stderr = '';
    const onLine = (line) => {
      // Pass child JSON-logs straight through to journald.
      process.stdout.write(line + '\n');
      try {
        const parsed = JSON.parse(line);
        if (typeof parsed.run_id === 'number') lastRunId = parsed.run_id;
      } catch { /* not a JSON log line */ }
    };

    let buf = '';
    child.stdout.on('data', (chunk) => {
      buf += chunk.toString('utf8');
      let nl;
      while ((nl = buf.indexOf('\n')) !== -1) {
        const line = buf.slice(0, nl).trimEnd();
        buf = buf.slice(nl + 1);
        if (line) onLine(line);
      }
    });
    child.stderr.on('data', (chunk) => { stderr += chunk.toString('utf8'); });

    child.on('exit', (code) => {
      if (buf.trim()) onLine(buf.trim());
      resolveP({
        ok: code === 0,
        run_id: lastRunId,
        error: code === 0 ? null : (stderr || `exit ${code}`).slice(0, 500),
      });
    });
  });
}

async function processOne(req) {
  log('info', 'request claim', { request_id: req.request_id, view_id: req.view_id, view_name: req.view_name, attempt: req.attempt });

  const claim = await api('POST', `/sidecar/run-requests/${req.request_id}/claim`);
  if (!claim?.claimed) {
    log('warn', 'request already claimed by another worker', { request_id: req.request_id });
    return;
  }

  log('info', 'request running', { request_id: req.request_id });
  const result = await ingestSingleView(req.view_id);

  if (result.ok) {
    await api('POST', `/sidecar/run-requests/${req.request_id}/complete`, {
      status: 'success',
      run_id: result.run_id,
    });
    log('info', 'request success', { request_id: req.request_id, run_id: result.run_id });
  } else {
    const reply = await api('POST', `/sidecar/run-requests/${req.request_id}/complete`, {
      status: 'failed',
      error: result.error,
    });
    log('warn', 'request failed', { request_id: req.request_id, reply, error: result.error });
  }
}

// ─── Main: process all due requests, then exit ────────────────────────────
(async () => {
  log('info', 'request poller start', { api: API });

  let queue;
  try {
    const r = await api('GET', '/sidecar/run-requests');
    queue = r?.results ?? [];
  } catch (err) {
    log('error', 'failed to fetch request queue', { error: err instanceof Error ? err.message : String(err) });
    process.exit(1);
  }

  if (queue.length === 0) {
    log('info', 'no due requests');
    process.exit(0);
  }

  log('info', 'processing requests', { count: queue.length });

  // Run sequentially — USAspending is rate-limited and we don't want the
  // shared OCI VM to stack concurrent ingests.
  for (const req of queue) {
    try {
      await processOne(req);
    } catch (err) {
      log('error', 'processOne crashed', { request_id: req.request_id, error: err instanceof Error ? err.message : String(err) });
      // Best-effort fail report so the row gets re-armed (or marked failed).
      try {
        await api('POST', `/sidecar/run-requests/${req.request_id}/complete`, {
          status: 'failed',
          error: `poller crash: ${err instanceof Error ? err.message : String(err)}`,
        });
      } catch { /* swallow */ }
    }
  }

  log('info', 'request poller done');
  process.exit(0);
})();
