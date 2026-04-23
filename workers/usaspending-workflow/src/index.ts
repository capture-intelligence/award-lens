import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import { UsaspendingAdapter, gzip, nowIso, type NormalizeMsg, type UsaspendingFilters } from '@awards/core';

export interface Env {
  DB: D1Database;
  STAGING: R2Bucket;
  META: KVNamespace;
  NORMALIZE_QUEUE: Queue<NormalizeMsg>;
  USASPENDING_WORKFLOW: Workflow;
}

export type SyncParams = {
  mode: 'incremental' | 'backfill';
  sinceIso?: string;
  untilIso?: string;
  maxPages?: number;   // safety cap, default unlimited
  filters?: UsaspendingFilters; // scope to agency/keyword/NAICS/etc.
};

const SOURCE_ID = 'usaspending';
const DEFAULT_INCR_LOOKBACK_DAYS = 2;
const PACE_MS = 1500; // ≈40 req/min, well under their guidance

export class UsaspendingSyncWorkflow extends WorkflowEntrypoint<Env, SyncParams> {
  async run(event: WorkflowEvent<SyncParams>, step: WorkflowStep): Promise<void> {
    const { mode, maxPages } = event.payload;

    // ── Step 1: Resolve window ────────────────────────────────────────────
    const window = await step.do('resolve-window', async () => {
      const watermark = await this.env.META.get(`WATERMARK/${SOURCE_ID}/award_transactions`);
      const until = event.payload.untilIso ?? nowIso();
      let since: string;
      if (mode === 'backfill') {
        if (!event.payload.sinceIso) throw new Error('backfill requires sinceIso');
        since = event.payload.sinceIso;
      } else {
        if (watermark) {
          since = watermark;
        } else {
          const d = new Date(until);
          d.setUTCDate(d.getUTCDate() - DEFAULT_INCR_LOOKBACK_DAYS);
          since = d.toISOString();
        }
      }
      return { since, until };
    });

    // ── Step 2: Open ingestion_run row ────────────────────────────────────
    const runId = await step.do('open-run', async () => {
      const res = await this.env.DB.prepare(`
        INSERT INTO ingestion_run
          (source_id, started_at, status, watermark_before, workflow_instance_id)
        VALUES (?, ?, 'running', ?, ?)
        RETURNING run_id
      `).bind(SOURCE_ID, nowIso(), window.since, event.instanceId).first<{ run_id: number }>();
      if (!res) throw new Error('failed to open ingestion_run row');
      return res.run_id;
    });

    // ── Step 3: Paginate ──────────────────────────────────────────────────
    const adapter = new UsaspendingAdapter(event.payload.filters);
    let page = 1;
    let totalFetched = 0;
    const hardCap = maxPages ?? 10_000;

    // eslint-disable-next-line no-constant-condition
    while (page <= hardCap) {
      const pageNum = page;
      const stepResult = await step.do(
        `fetch-page-${pageNum}`,
        {
          retries: { limit: 5, delay: '30 seconds', backoff: 'exponential' },
          timeout: '5 minutes',
        },
        async () => {
          const { raw, hasMore, records } = await adapter.fetchPage(window, pageNum);

          const dateSlug = window.until.slice(0, 10);
          const key = `${SOURCE_ID}/${dateSlug}/run_${runId}/page_${String(pageNum).padStart(5, '0')}.json.gz`;

          // Persist raw JSON to R2 (gzipped)
          const body = await gzip(JSON.stringify(raw.response));
          await this.env.STAGING.put(key, body, {
            httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
            customMetadata: {
              runId: String(runId),
              page: String(pageNum),
              source: SOURCE_ID,
              responseHash: raw.responseHash,
            },
          });

          // Record staging row
          await this.env.DB.prepare(`
            INSERT INTO staging_raw_record
              (run_id, source_id, endpoint, request_params, response_hash, r2_key, fetched_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(source_id, response_hash) DO NOTHING
          `).bind(
            runId, SOURCE_ID, raw.endpoint,
            JSON.stringify(raw.requestParams),
            raw.responseHash, key, nowIso(),
          ).run();

          // Enqueue normalization
          await this.env.NORMALIZE_QUEUE.send({
            source: SOURCE_ID,
            runId,
            stagingKey: key,
            recordCount: records.length,
          });

          return { hasMore, count: records.length };
        },
      );

      totalFetched += stepResult.count;
      if (!stepResult.hasMore) break;
      page++;
      await step.sleep(`pace-${pageNum}`, `${PACE_MS} milliseconds`);
    }

    // ── Step 4: Finalize ──────────────────────────────────────────────────
    await step.do('finalize', async () => {
      await this.env.META.put(
        `WATERMARK/${SOURCE_ID}/award_transactions`,
        window.until,
      );
      await this.env.DB.prepare(`
        UPDATE ingestion_run
        SET finished_at = ?, status = 'success',
            rows_fetched = ?, watermark_after = ?
        WHERE run_id = ?
      `).bind(nowIso(), totalFetched, window.until, runId).run();
    });
  }
}

// HTTP entrypoint so the workflow can be triggered ad-hoc for backfills.
// POST /trigger  body: { mode, sinceIso?, untilIso?, maxPages? }
export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    const body = await req.json<SyncParams>().catch(() => null);
    if (!body?.mode) return new Response('missing "mode"', { status: 400 });
    const instance = await env.USASPENDING_WORKFLOW.create({ params: body });
    return Response.json({ id: instance.id, status: await instance.status() });
  },
} satisfies ExportedHandler<Env>;
