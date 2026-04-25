import { lookupEntityByUei, applySamEntityToWarehouse } from './enrich.js';

export interface Env {
  DB: D1Database;
  META: KVNamespace;
  SAM_GOV_API_KEY: string;
}

const DAILY_LIMIT = 10;

function dateKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function nextResetIso(): string {
  const d = new Date();
  d.setUTCHours(24, 0, 0, 0);
  return d.toISOString();
}

/**
 * Atomic budget acquisition via SQLite's ON CONFLICT DO UPDATE WHERE.
 * If the update is blocked by the WHERE clause (would exceed limit),
 * RETURNING returns no rows → caller treats as 429.
 */
async function tryAcquireBudget(db: D1Database): Promise<{
  granted: boolean; used: number; limit: number; remaining: number; resetsAt: string;
}> {
  const date = dateKey();
  const now = new Date().toISOString();

  const claimed = await db.prepare(`
    INSERT INTO sam_api_budget (date_utc, used, limit_total, last_call_at)
    VALUES (?, 1, ?, ?)
    ON CONFLICT(date_utc) DO UPDATE
      SET used = sam_api_budget.used + 1, last_call_at = excluded.last_call_at
      WHERE sam_api_budget.used < sam_api_budget.limit_total
    RETURNING used, limit_total
  `).bind(date, DAILY_LIMIT, now).first<{ used: number; limit_total: number }>();

  if (claimed) {
    return {
      granted: true,
      used: claimed.used,
      limit: claimed.limit_total,
      remaining: claimed.limit_total - claimed.used,
      resetsAt: nextResetIso(),
    };
  }

  const cur = await db.prepare('SELECT used, limit_total FROM sam_api_budget WHERE date_utc = ?')
    .bind(date).first<{ used: number; limit_total: number }>();
  const limit = cur?.limit_total ?? DAILY_LIMIT;
  const used = cur?.used ?? limit;
  return {
    granted: false,
    used,
    limit,
    remaining: Math.max(0, limit - used),
    resetsAt: nextResetIso(),
  };
}

async function releaseBudget(db: D1Database): Promise<void> {
  // Best-effort decrement on call failure so retries aren't double-billed.
  await db.prepare(`
    UPDATE sam_api_budget
    SET used = MAX(0, used - 1)
    WHERE date_utc = ?
  `).bind(dateKey()).run();
}

async function getStatus(db: D1Database): Promise<{
  used: number; limit: number; remaining: number; dateKey: string; resetsAt: string;
}> {
  const cur = await db.prepare('SELECT used, limit_total FROM sam_api_budget WHERE date_utc = ?')
    .bind(dateKey()).first<{ used: number; limit_total: number }>();
  const limit = cur?.limit_total ?? DAILY_LIMIT;
  const used = cur?.used ?? 0;
  return {
    used,
    limit,
    remaining: Math.max(0, limit - used),
    dateKey: dateKey(),
    resetsAt: nextResetIso(),
  };
}

async function enrichOne(env: Env, uei: string): Promise<{
  found: boolean; vendorsUpdated?: number; classificationsAdded?: number;
}> {
  const entity = await lookupEntityByUei(uei, env.SAM_GOV_API_KEY);
  if (!entity) return { found: false };
  const res = await applySamEntityToWarehouse(env.DB, uei, entity);
  return { found: true, ...res };
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);

    if (url.pathname === '/status') {
      return Response.json(await getStatus(env.DB));
    }

    if (url.pathname.startsWith('/enrich/') && req.method === 'POST') {
      const uei = url.pathname.slice('/enrich/'.length);
      if (!/^[A-Z0-9]{12}$/.test(uei)) {
        return Response.json({ error: 'invalid UEI format' }, { status: 400 });
      }

      const budget = await tryAcquireBudget(env.DB);
      if (!budget.granted) {
        return Response.json({ error: 'budget exhausted', status: budget }, { status: 429 });
      }

      try {
        const out = await enrichOne(env, uei);
        return Response.json({ uei, budget, ...out });
      } catch (e) {
        await releaseBudget(env.DB);
        const msg = e instanceof Error ? e.message : String(e);
        return Response.json({ error: msg }, { status: 500 });
      }
    }

    return new Response('sam-api-worker', { status: 200 });
  },
} satisfies ExportedHandler<Env>;
