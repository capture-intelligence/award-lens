import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import {
  searchGrantsGov,
  fetchGrantsGovOpportunity,
  hitToDbRow,
  gzip,
  nowIso,
  chunk,
  type GrantsGovSearchHit,
} from '@awards/core';

export interface Env {
  DB: D1Database;
  STAGING: R2Bucket;
  META: KVNamespace;
  GRANTS_GOV_WORKFLOW: Workflow;
}

export type GrantsGovParams = {
  statuses?: Array<'posted' | 'forecasted' | 'closed' | 'archived'>;
  agencies?: string[];
  cfda?: string[];
  keyword?: string;
  enrichDetail?: boolean;   // fetch full detail per hit (slower)
  maxRecords?: number;      // safety cap
};

const SOURCE_ID = 'grants_gov';
const PAGE_SIZE = 1000;
const DETAIL_BATCH = 10;
const DETAIL_PACE_MS = 200;

export class GrantsGovSyncWorkflow extends WorkflowEntrypoint<Env, GrantsGovParams> {
  async run(event: WorkflowEvent<GrantsGovParams>, step: WorkflowStep): Promise<void> {
    const params = event.payload;
    const extractDate = nowIso().slice(0, 10);

    const runId = await step.do('open-run', async () => {
      const res = await this.env.DB.prepare(`
        INSERT INTO ingestion_run (source_id, started_at, status, workflow_instance_id)
        VALUES (?, ?, 'running', ?)
        RETURNING run_id
      `).bind(SOURCE_ID, nowIso(), event.instanceId).first<{ run_id: number }>();
      if (!res) throw new Error('failed to open run');
      return res.run_id;
    });

    // ── Step 1: paginate search ────────────────────────────────────────
    const allHits: GrantsGovSearchHit[] = [];
    let start = 0;
    let pageNum = 1;
    const hardCap = params.maxRecords ?? 25_000;

    while (allHits.length < hardCap) {
      const { hits, hitCount } = await step.do(
        `search-page-${pageNum}`,
        { retries: { limit: 4, delay: '30 seconds', backoff: 'exponential' }, timeout: '3 minutes' },
        async () => {
          const { hits, hitCount, raw } = await searchGrantsGov({
            keyword: params.keyword,
            statuses: params.statuses ?? ['posted', 'forecasted'],
            agencies: params.agencies,
            cfda: params.cfda,
            rows: PAGE_SIZE,
            startRecordNum: start,
          });

          const key = `grants_gov/${extractDate}/run_${runId}/search_${String(pageNum).padStart(4, '0')}.json.gz`;
          await this.env.STAGING.put(key, await gzip(JSON.stringify(raw.response)), {
            httpMetadata: { contentType: 'application/json', contentEncoding: 'gzip' },
            customMetadata: { runId: String(runId), page: String(pageNum), source: SOURCE_ID, responseHash: raw.responseHash },
          });
          await this.env.DB.prepare(`
            INSERT INTO staging_raw_record
              (run_id, source_id, endpoint, request_params, response_hash, r2_key, fetched_at, status)
            VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
            ON CONFLICT(source_id, response_hash) DO NOTHING
          `).bind(
            runId, SOURCE_ID, '/search2', JSON.stringify(raw.request),
            raw.responseHash, key, raw.fetchedAt,
          ).run();

          return { hits, hitCount };
        },
      );

      allHits.push(...hits);
      if (allHits.length >= hitCount || hits.length < PAGE_SIZE) break;
      start += PAGE_SIZE;
      pageNum++;
      await step.sleep(`pace-search-${pageNum}`, '2 seconds');
    }

    const trimmed = allHits.slice(0, hardCap);

    // ── Step 2: optional detail enrichment ─────────────────────────────
    const enriched = new Map<string, Awaited<ReturnType<typeof fetchGrantsGovOpportunity>>>();
    if (params.enrichDetail) {
      let batchNum = 0;
      for (const batch of chunk(trimmed, DETAIL_BATCH)) {
        batchNum++;
        await step.do(
          `enrich-batch-${batchNum}`,
          { retries: { limit: 3, delay: '20 seconds' }, timeout: '2 minutes' },
          async () => {
            for (const hit of batch) {
              try {
                const detail = await fetchGrantsGovOpportunity(hit.id);
                enriched.set(String(hit.id), detail);
              } catch (e) {
                console.warn(`[grants-gov] enrich failed for ${hit.id}: ${e}`);
              }
              await new Promise((r) => setTimeout(r, DETAIL_PACE_MS));
            }
          },
        );
      }
    }

    // ── Step 3: upsert into grant_opportunity ──────────────────────────
    const upserted = await step.do(
      'upsert',
      { retries: { limit: 2, delay: '15 seconds' } },
      async () => {
        let count = 0;
        for (const rows of chunk(trimmed, 100)) {
          const stmts: D1PreparedStatement[] = [];
          const now = nowIso();
          for (const hit of rows) {
            const detail = enriched.get(String(hit.id)) ?? null;
            const r = hitToDbRow(hit, detail, extractDate);
            stmts.push(this.env.DB.prepare(`
              INSERT INTO grant_opportunity
                (opportunity_id, opportunity_number, title, agency_code, agency_name,
                 category, funding_instrument, assistance_listings, posted_date, close_date,
                 archive_date, est_total_funding, award_ceiling, award_floor, expected_awards,
                 eligibility_codes, description, status, opportunity_url, doc_type,
                 extract_date, created_at, updated_at)
              VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT(opportunity_id) DO UPDATE SET
                opportunity_number  = excluded.opportunity_number,
                title               = excluded.title,
                agency_code         = COALESCE(excluded.agency_code, grant_opportunity.agency_code),
                agency_name         = COALESCE(excluded.agency_name, grant_opportunity.agency_name),
                category            = COALESCE(excluded.category, grant_opportunity.category),
                funding_instrument  = COALESCE(excluded.funding_instrument, grant_opportunity.funding_instrument),
                assistance_listings = COALESCE(excluded.assistance_listings, grant_opportunity.assistance_listings),
                posted_date         = COALESCE(excluded.posted_date, grant_opportunity.posted_date),
                close_date          = COALESCE(excluded.close_date, grant_opportunity.close_date),
                archive_date        = COALESCE(excluded.archive_date, grant_opportunity.archive_date),
                est_total_funding   = COALESCE(excluded.est_total_funding, grant_opportunity.est_total_funding),
                award_ceiling       = COALESCE(excluded.award_ceiling, grant_opportunity.award_ceiling),
                award_floor         = COALESCE(excluded.award_floor, grant_opportunity.award_floor),
                expected_awards     = COALESCE(excluded.expected_awards, grant_opportunity.expected_awards),
                eligibility_codes   = COALESCE(excluded.eligibility_codes, grant_opportunity.eligibility_codes),
                description         = COALESCE(excluded.description, grant_opportunity.description),
                status              = excluded.status,
                doc_type            = COALESCE(excluded.doc_type, grant_opportunity.doc_type),
                extract_date        = excluded.extract_date,
                updated_at          = excluded.updated_at
            `).bind(
              r.opportunity_id, r.opportunity_number, r.title, r.agency_code, r.agency_name,
              r.category, r.funding_instrument, r.assistance_listings, r.posted_date, r.close_date,
              r.archive_date, r.est_total_funding, r.award_ceiling, r.award_floor, r.expected_awards,
              r.eligibility_codes, r.description, r.status, r.opportunity_url, r.doc_type,
              r.extract_date, now, now,
            ));
          }
          await this.env.DB.batch(stmts);
          count += rows.length;
        }
        return count;
      },
    );

    await step.do('finalize', async () => {
      await this.env.META.put(`WATERMARK/${SOURCE_ID}/last_extract`, extractDate);
      await this.env.DB.prepare(`
        UPDATE ingestion_run
        SET finished_at = ?, status = 'success',
            rows_fetched = ?, rows_upserted = ?, watermark_after = ?
        WHERE run_id = ?
      `).bind(nowIso(), trimmed.length, upserted, extractDate, runId).run();
    });
  }
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    const body = await req.json<GrantsGovParams>().catch(() => ({} as GrantsGovParams));
    const instance = await env.GRANTS_GOV_WORKFLOW.create({ params: body });
    return Response.json({ id: instance.id });
  },
} satisfies ExportedHandler<Env>;
