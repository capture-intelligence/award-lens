import {
  WorkflowEntrypoint,
  type WorkflowEvent,
  type WorkflowStep,
} from 'cloudflare:workers';
import {
  SAM_EXTRACTS,
  fetchSamExtract,
  iterateExtractRows,
  exclusionRowToDb,
  chunk,
  nowIso,
  type SamExtractDescriptor,
} from '@awards/core';

export interface Env {
  DB: D1Database;
  STAGING: R2Bucket;
  META: KVNamespace;
  SAM_BULK_WORKFLOW: Workflow;
}

export type SamBulkParams = {
  extracts: Array<'exclusions' | 'entity_delta'>;
};

const SOURCE_ID = 'sam_bulk';
const UPSERT_BATCH = 200;

export class SamBulkSyncWorkflow extends WorkflowEntrypoint<Env, SamBulkParams> {
  async run(event: WorkflowEvent<SamBulkParams>, step: WorkflowStep): Promise<void> {
    const extractKeys = event.payload.extracts ?? ['exclusions'];
    const extractDate = nowIso().slice(0, 10);

    // Open ingestion_run row
    const runId = await step.do('open-run', async () => {
      const res = await this.env.DB.prepare(`
        INSERT INTO ingestion_run (source_id, started_at, status, workflow_instance_id)
        VALUES (?, ?, 'running', ?)
        RETURNING run_id
      `).bind(SOURCE_ID, nowIso(), event.instanceId).first<{ run_id: number }>();
      if (!res) throw new Error('failed to open ingestion_run');
      return res.run_id;
    });

    let totalRows = 0;

    for (const key of extractKeys) {
      const descriptor = SAM_EXTRACTS[key];
      if (!descriptor) throw new Error(`unknown extract: ${key}`);

      // Step A: Download and park in R2
      const r2Key = await step.do(
        `download-${key}`,
        { retries: { limit: 3, delay: '1 minute', backoff: 'exponential' }, timeout: '10 minutes' },
        async () => downloadToR2(this.env, runId, descriptor, extractDate),
      );

      // Step B: Parse + upsert
      const rows = await step.do(
        `parse-and-upsert-${key}`,
        { retries: { limit: 2, delay: '30 seconds' }, timeout: '15 minutes' },
        async () => parseAndUpsert(this.env, runId, key, r2Key, extractDate),
      );
      totalRows += rows;
    }

    await step.do('finalize', async () => {
      await this.env.META.put(`WATERMARK/${SOURCE_ID}/last_extract`, extractDate);
      await this.env.DB.prepare(`
        UPDATE ingestion_run
        SET finished_at = ?, status = 'success',
            rows_fetched = ?, rows_upserted = ?, watermark_after = ?
        WHERE run_id = ?
      `).bind(nowIso(), totalRows, totalRows, extractDate, runId).run();
    });
  }
}

async function downloadToR2(
  env: Env,
  runId: number,
  descriptor: SamExtractDescriptor,
  extractDate: string,
): Promise<string> {
  const fetched = await fetchSamExtract(descriptor);
  const key = `sam_bulk/${extractDate}/run_${runId}/${descriptor.id}.zip`;
  await env.STAGING.put(key, fetched.zipBytes, {
    httpMetadata: { contentType: 'application/zip' },
    customMetadata: {
      runId: String(runId),
      source: SOURCE_ID,
      extract: descriptor.id,
      responseHash: fetched.responseHash,
      extractDate,
    },
  });
  await env.DB.prepare(`
    INSERT INTO staging_raw_record
      (run_id, source_id, endpoint, request_params, response_hash, r2_key, fetched_at, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, 'pending')
    ON CONFLICT(source_id, response_hash) DO NOTHING
  `).bind(
    runId, SOURCE_ID, descriptor.id, JSON.stringify({ url: descriptor.url }),
    fetched.responseHash, key, fetched.fetchedAt,
  ).run();
  return key;
}

async function parseAndUpsert(
  env: Env,
  runId: number,
  extractId: string,
  r2Key: string,
  extractDate: string,
): Promise<number> {
  const obj = await env.STAGING.get(r2Key);
  if (!obj) throw new Error(`R2 missing: ${r2Key}`);
  const zipBytes = new Uint8Array(await obj.arrayBuffer());

  if (extractId !== 'exclusions') {
    console.warn(`[sam-bulk] ${extractId}: parsing stub — skipped`);
    return 0;
  }

  // Collect rows into batches for atomic D1 writes
  const buf: ReturnType<typeof exclusionRowToDb>[] = [];
  let total = 0;

  for (const row of iterateExtractRows(zipBytes)) {
    buf.push(exclusionRowToDb(row as Parameters<typeof exclusionRowToDb>[0], extractDate));
    if (buf.length >= UPSERT_BATCH) {
      await flushExclusions(env.DB, buf.splice(0, buf.length));
      total += UPSERT_BATCH;
    }
  }
  if (buf.length) {
    await flushExclusions(env.DB, buf);
    total += buf.length;
  }

  await env.DB.prepare(`UPDATE staging_raw_record SET status = 'parsed' WHERE r2_key = ?`)
    .bind(r2Key).run();

  console.log(`[sam-bulk] exclusions: upserted ${total} rows`);
  return total;
}

async function flushExclusions(
  db: D1Database,
  rows: ReturnType<typeof exclusionRowToDb>[],
): Promise<void> {
  const now = nowIso();
  const stmts: D1PreparedStatement[] = [];
  for (const r of rows) {
    stmts.push(db.prepare(`
      INSERT INTO sam_exclusion
        (exclusion_id, source_row_id, uei, duns, cage_code, legal_name,
         classification, exclusion_type, ct_code, is_active,
         active_date, termination_date, excluding_agency, reason,
         country_code, state, city, address_line, zip,
         extract_date, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(exclusion_id) DO UPDATE SET
        is_active        = excluded.is_active,
        termination_date = excluded.termination_date,
        reason           = excluded.reason,
        extract_date     = excluded.extract_date,
        updated_at       = excluded.updated_at
    `).bind(
      r.exclusion_id, r.source_row_id, r.uei, r.duns, r.cage_code, r.legal_name,
      r.classification, r.exclusion_type, r.ct_code, r.is_active,
      r.active_date, r.termination_date, r.excluding_agency, r.reason,
      r.country_code, r.state, r.city, r.address_line, r.zip,
      r.extract_date, now, now,
    ));
  }
  await db.batch(stmts);
}

export default {
  async fetch(req: Request, env: Env): Promise<Response> {
    if (req.method !== 'POST') return new Response('POST only', { status: 405 });
    const body = await req.json<SamBulkParams>().catch(() => null);
    const params = body ?? { extracts: ['exclusions'] };
    const instance = await env.SAM_BULK_WORKFLOW.create({ params });
    return Response.json({ id: instance.id });
  },
} satisfies ExportedHandler<Env>;
