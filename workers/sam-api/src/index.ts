import type { SamEnrichMsg } from '@awards/core';
import { SamApiBudget } from './budget.js';
import { lookupEntityByUei, applySamEntityToWarehouse } from './enrich.js';

export { SamApiBudget };

export interface Env {
  DB: D1Database;
  META: KVNamespace;
  BUDGET: DurableObjectNamespace;
  SAM_GOV_API_KEY: string;
}

const BUDGET_KEY = 'global';

/**
 * SAM.gov API worker.
 *
 *   queue()     → drains sam-enrich-queue under the 10/day budget
 *   scheduled() → optional top-N vendor rotation (disabled by default)
 *   fetch()     → /status, /enrich/:uei (manual/API trigger)
 */
export default {
  async queue(batch: MessageBatch<SamEnrichMsg>, env: Env): Promise<void> {
    const budgetStub = env.BUDGET.get(env.BUDGET.idFromName(BUDGET_KEY));

    for (const msg of batch.messages) {
      const acquire = await budgetStub.fetch('https://budget/acquire');
      if (acquire.status === 429) {
        // Budget exhausted — retry tomorrow
        const body = await acquire.json<{ resetsAt?: string }>();
        const retryAt = body?.resetsAt ? new Date(body.resetsAt) : null;
        const delay = retryAt
          ? Math.max(60, Math.floor((retryAt.getTime() - Date.now()) / 1000))
          : 3600;
        msg.retry({ delaySeconds: delay });
        continue;
      }

      try {
        await enrichOne(env, msg.body.uei);
        msg.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[sam-api] enrich failed for ${msg.body.uei}: ${reason}`);
        // Return the slot so a retry isn't double-billed
        await budgetStub.fetch('https://budget/release').catch(() => {});
        msg.retry({ delaySeconds: 60 });
      }
    }
  },

  async scheduled(_event: ScheduledEvent, env: Env, ctx: ExecutionContext): Promise<void> {
    // "Top-up" rotation: each scheduled firing refreshes up to 100 vendors
    // (one SAM API page) using one budget slot. Run multiple times/day if
    // you've enabled the aggressive cron in wrangler.toml.
    ctx.waitUntil(runRotation(env));
  },

  async fetch(req: Request, env: Env): Promise<Response> {
    const url = new URL(req.url);
    const budgetStub = env.BUDGET.get(env.BUDGET.idFromName(BUDGET_KEY));

    if (url.pathname === '/status') {
      const status = await budgetStub.fetch('https://budget/status').then((r) => r.json());
      return Response.json(status);
    }

    if (url.pathname.startsWith('/enrich/') && req.method === 'POST') {
      const uei = url.pathname.slice('/enrich/'.length);
      if (!/^[A-Z0-9]{12}$/.test(uei)) {
        return Response.json({ error: 'invalid UEI format' }, { status: 400 });
      }
      const acquire = await budgetStub.fetch('https://budget/acquire');
      if (acquire.status === 429) {
        const status = await acquire.json();
        return Response.json({ error: 'budget exhausted', status }, { status: 429 });
      }
      try {
        const out = await enrichOne(env, uei);
        return Response.json({ uei, ...out });
      } catch (e) {
        await budgetStub.fetch('https://budget/release').catch(() => {});
        throw e;
      }
    }

    return new Response('sam-api-worker', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

async function enrichOne(env: Env, uei: string): Promise<{
  found: boolean;
  vendorsUpdated?: number;
  classificationsAdded?: number;
}> {
  const entity = await lookupEntityByUei(uei, env.SAM_GOV_API_KEY);
  if (!entity) return { found: false };
  const res = await applySamEntityToWarehouse(env.DB, uei, entity);
  return { found: true, ...res };
}

/**
 * Background rotation: refresh vendors whose SAM enrichment is stale or
 * missing, starting with the most-active (by current contract total).
 * Spends 1 budget slot per call (returns up to 100 entities).
 */
async function runRotation(env: Env): Promise<void> {
  const budgetStub = env.BUDGET.get(env.BUDGET.idFromName(BUDGET_KEY));
  const acquire = await budgetStub.fetch('https://budget/acquire');
  if (acquire.status === 429) {
    console.log('[sam-api] rotation skipped: budget exhausted');
    return;
  }

  const staleVendors = await env.DB.prepare(`
    SELECT v.uei
    FROM vendor v
    LEFT JOIN (
      SELECT vendor_id, MAX(effective_from) AS last_sam
      FROM vendor_classification
      WHERE source_id = 'sam_api'
      GROUP BY vendor_id
    ) e ON e.vendor_id = v.vendor_id
    JOIN v_vendor_rollup r ON r.vendor_id = v.vendor_id
    WHERE v.uei IS NOT NULL
      AND (e.last_sam IS NULL OR date(e.last_sam) < date('now', '-30 days'))
    ORDER BY r.total_value DESC
    LIMIT 100
  `).all<{ uei: string }>();

  const ueis = staleVendors.results.map((r) => r.uei).join(',');
  if (!ueis) { console.log('[sam-api] rotation: no stale vendors'); return; }

  const url = new URL('https://api.sam.gov/entity-information/v4/entities');
  url.searchParams.set('ueiSAM', ueis);
  url.searchParams.set('api_key', env.SAM_GOV_API_KEY);
  url.searchParams.set('includeSections', 'entityRegistration,coreData');
  url.searchParams.set('pageSize', '100');

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (!res.ok) {
    await budgetStub.fetch('https://budget/release').catch(() => {});
    throw new Error(`SAM rotation ${res.status}`);
  }
  const data = await res.json() as { entityData?: Array<{ entityRegistration?: { ueiSAM?: string } }> };
  let processed = 0;
  for (const entity of data.entityData ?? []) {
    const uei = entity.entityRegistration?.ueiSAM;
    if (!uei) continue;
    await applySamEntityToWarehouse(env.DB, uei, entity as Parameters<typeof applySamEntityToWarehouse>[2]);
    processed++;
  }
  console.log(`[sam-api] rotation processed ${processed} vendors`);
  await env.META.put('LAST_SAM_ROTATION', new Date().toISOString());
}
