/**
 * "Run now" lifecycle: admin triggers a one-off ingestion for a single view.
 *
 *  Admin UI         → POST /admin/views/:id/run            (admin session)
 *  Sidecar trigger  → GET  /admin/sidecar/run-requests     (INGEST_TOKEN)
 *  Sidecar trigger  → POST /admin/sidecar/run-requests/:id/claim     (token)
 *  Sidecar trigger  → POST /admin/sidecar/run-requests/:id/complete  (token)
 *
 * Failures retry with exponential backoff: 1, 2, 4, 8, 16 minutes (5 attempts
 * by default). After exhausting attempts the row settles into status='failed'.
 */

import { Hono, type Context } from 'hono';
import { nowIso, requireAdmin, type AuthVars } from '../auth/session.js';

// 8 attempts: each retry's enrichment cache hits make later attempts faster,
// so even cold-cache broadened pulls (~1500 awards) can finish within budget.
export const MAX_ATTEMPTS = 8;
export const FETCH_LIMIT = 5;       // max pending rows the sidecar picks per poll

export interface RunsEnv {
  DB: D1Database;
  INGEST_TOKEN?: string;
}
type Ctx = { Bindings: RunsEnv; Variables: AuthVars };

interface RunRequestRow {
  request_id: string;
  view_id: string;
  requested_by: string;
  requested_at: string;
  requested_note: string | null;
  status: 'pending' | 'running' | 'success' | 'failed';
  attempt: number;
  max_attempts: number;
  next_attempt_at: string;
  started_at: string | null;
  finished_at: string | null;
  run_id: number | null;
  error_message: string | null;
}

function newId(): string {
  return crypto.randomUUID();
}

export function checkIngestToken(c: { req: { header: (k: string) => string | undefined }; env: RunsEnv }): string | null {
  const expected = c.env.INGEST_TOKEN;
  if (!expected) return null;
  const supplied = (c.req.header('authorization') ?? '').replace(/^Bearer\s+/i, '').trim();
  if (!supplied || supplied.length !== expected.length) return 'unauthorized';
  let eq = 0;
  for (let i = 0; i < supplied.length; i++) eq |= supplied.charCodeAt(i) ^ expected.charCodeAt(i);
  return eq === 0 ? null : 'unauthorized';
}

// =================================================================
// Admin (session-auth): trigger + status
// =================================================================

export const adminRunsApp = new Hono<Ctx>();
adminRunsApp.use('*', requireAdmin);

// Trigger a Run Now for a specific view. Idempotent in the loose sense:
// if a pending/running request already exists for this view, returns it
// instead of stacking duplicates.
adminRunsApp.post('/:viewId/run', async (c) => {
  const viewId = c.req.param('viewId');
  const view = await c.env.DB.prepare(
    'SELECT view_id FROM data_view WHERE view_id = ? AND enabled = 1',
  ).bind(viewId).first();
  if (!view) return c.json({ error: 'view_not_found_or_disabled' }, 404);

  const body = await c.req.json().catch(() => ({})) as { note?: string };

  // Coalesce: if there's an active (pending or running) request for this
  // view, return it rather than queueing a second.
  const existing = await c.env.DB.prepare(`
    SELECT request_id, status FROM view_run_request
    WHERE view_id = ? AND status IN ('pending', 'running')
    ORDER BY requested_at DESC LIMIT 1
  `).bind(viewId).first<{ request_id: string; status: string }>();
  if (existing) return c.json({ request_id: existing.request_id, status: existing.status, deduped: true }, 200);

  const requestId = newId();
  const now = nowIso();
  await c.env.DB.prepare(`
    INSERT INTO view_run_request
      (request_id, view_id, requested_by, requested_at, requested_note,
       status, attempt, max_attempts, next_attempt_at)
    VALUES (?, ?, ?, ?, ?, 'pending', 0, ?, ?)
  `).bind(
    requestId, viewId, c.var.user!.user_id, now,
    body.note ?? null, MAX_ATTEMPTS, now,
  ).run();

  return c.json({ request_id: requestId, status: 'pending' }, 202);
});

// Per-view recent request list (most-recent-first). The Admin Views table
// shows the latest one's status as a chip.
adminRunsApp.get('/:viewId/runs', async (c) => {
  const viewId = c.req.param('viewId');
  const r = await c.env.DB.prepare(`
    SELECT * FROM view_run_request
    WHERE view_id = ?
    ORDER BY requested_at DESC
    LIMIT 20
  `).bind(viewId).all<RunRequestRow>();
  return c.json({ count: r.results.length, results: r.results });
});

// =================================================================
// Sidecar (token-auth) — exposed as standalone handlers and registered
// directly on the root app in index.ts. Going through a sub-app under
// /admin/* would get caught by adminUsersApp's `requireAdmin` middleware.
// =================================================================

/** GET /admin/sidecar/run-requests — list pending requests due for processing. */
export async function listSidecarRunRequests(
  c: Context<{ Bindings: RunsEnv }>,
): Promise<Response> {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);

  const r = await c.env.DB.prepare(`
    SELECT vrq.*, dv.name AS view_name, dv.filters_json
    FROM view_run_request vrq
    JOIN data_view dv ON dv.view_id = vrq.view_id AND dv.enabled = 1
    WHERE vrq.status = 'pending'
      AND datetime(vrq.next_attempt_at) <= datetime('now')
    ORDER BY vrq.requested_at ASC
    LIMIT ?
  `).bind(FETCH_LIMIT).all<RunRequestRow & { view_name: string; filters_json: string }>();

  return c.json({
    count: r.results.length,
    results: r.results.map((row) => ({
      request_id: row.request_id,
      view_id:    row.view_id,
      view_name:  row.view_name,
      filters:    JSON.parse(row.filters_json),
      attempt:    row.attempt,
      max_attempts: row.max_attempts,
    })),
  });
}

/** POST /admin/sidecar/run-requests/:id/claim — atomically promote pending→running. */
export async function claimSidecarRunRequest(
  c: Context<{ Bindings: RunsEnv }>,
): Promise<Response> {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const result = await c.env.DB.prepare(`
    UPDATE view_run_request
    SET status = 'running', started_at = ?, attempt = attempt + 1
    WHERE request_id = ? AND status = 'pending'
  `).bind(nowIso(), c.req.param('requestId')).run();
  return c.json({ claimed: (result.meta?.changes ?? 0) > 0 });
}

/** POST /admin/sidecar/run-requests/:id/complete — finalize success / arm retry. */
export async function completeSidecarRunRequest(
  c: Context<{ Bindings: RunsEnv }>,
): Promise<Response> {
  const err = checkIngestToken(c); if (err) return c.json({ error: err }, 401);
  const requestId = c.req.param('requestId');
  const body = await c.req.json().catch(() => null) as
    | { status: 'success' | 'failed'; run_id?: number; error?: string }
    | null;
  if (!body || (body.status !== 'success' && body.status !== 'failed')) {
    return c.json({ error: 'invalid_status' }, 400);
  }

  const row = await c.env.DB.prepare(
    'SELECT attempt, max_attempts FROM view_run_request WHERE request_id = ?',
  ).bind(requestId).first<{ attempt: number; max_attempts: number }>();
  if (!row) return c.json({ error: 'not_found' }, 404);

  const now = nowIso();

  if (body.status === 'success') {
    await c.env.DB.prepare(`
      UPDATE view_run_request
      SET status = 'success', finished_at = ?, run_id = ?, error_message = NULL
      WHERE request_id = ?
    `).bind(now, body.run_id ?? null, requestId).run();
    return c.json({ ok: true, status: 'success' });
  }

  // Failure path.
  if (row.attempt >= row.max_attempts) {
    // Out of retries.
    await c.env.DB.prepare(`
      UPDATE view_run_request
      SET status = 'failed', finished_at = ?, error_message = ?
      WHERE request_id = ?
    `).bind(now, body.error ?? null, requestId).run();
    return c.json({ ok: true, status: 'failed', exhausted: true });
  }

  // Re-arm with exp backoff: 2^(attempt-1) minutes — 1, 2, 4, 8, 16 min.
  const backoffMin = Math.pow(2, Math.max(0, row.attempt - 1));
  const next = new Date(Date.now() + backoffMin * 60_000).toISOString();
  await c.env.DB.prepare(`
    UPDATE view_run_request
    SET status = 'pending', next_attempt_at = ?, error_message = ?,
        started_at = NULL
    WHERE request_id = ?
  `).bind(next, body.error ?? null, requestId).run();

  return c.json({ ok: true, status: 'pending', retry_in_minutes: backoffMin, next_attempt_at: next });
}
