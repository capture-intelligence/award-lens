import {
  UsaspendingAdapter,
  gunzipText,
  chunk,
  type NormalizeMsg,
  type UpsertMsg,
  type RawRecord,
  type CanonicalAward,
} from '@awards/core';

export interface Env {
  DB: D1Database;
  STAGING: R2Bucket;
  UPSERT_QUEUE: Queue<UpsertMsg>;
}

const UPSERT_BATCH_SIZE = 25;  // keep message payload under 128 KB

/**
 * Normalizer: pulls raw staging JSON from R2, parses & validates via the
 * source-specific adapter, then emits canonical DTOs to the upsert queue.
 */
export default {
  async queue(batch: MessageBatch<NormalizeMsg>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await processOne(msg.body, env);
        msg.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[normalizer] failure for ${msg.body.stagingKey}: ${reason}`);
        await markStagingFailed(env, msg.body.stagingKey, reason);
        msg.retry({ delaySeconds: 60 });
      }
    }
  },

  async fetch(): Promise<Response> {
    return new Response('normalizer-worker', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

async function processOne(job: NormalizeMsg, env: Env): Promise<void> {
  const obj = await env.STAGING.get(job.stagingKey);
  if (!obj) throw new Error(`R2 object missing: ${job.stagingKey}`);

  const text = await gunzipText(await obj.arrayBuffer());
  const response = JSON.parse(text);

  const raw: RawRecord = {
    endpoint: '(replay)',
    requestParams: {},
    response,
    responseHash: obj.customMetadata?.responseHash ?? '',
  };

  let canonical: CanonicalAward[] = [];
  switch (job.source) {
    case 'usaspending':
      canonical = new UsaspendingAdapter().parse(raw);
      break;
    default:
      throw new Error(`unknown source: ${job.source}`);
  }

  // Fan out to upsert queue in bounded chunks
  for (const records of chunk(canonical, UPSERT_BATCH_SIZE)) {
    await env.UPSERT_QUEUE.send({
      source: job.source,
      runId: job.runId,
      records,
    });
  }

  await env.DB.prepare(`
    UPDATE staging_raw_record
    SET status = 'parsed'
    WHERE r2_key = ?
  `).bind(job.stagingKey).run();

  console.log(`[normalizer] parsed ${canonical.length} rows from ${job.stagingKey}`);
}

async function markStagingFailed(env: Env, key: string, reason: string): Promise<void> {
  await env.DB.prepare(`
    UPDATE staging_raw_record
    SET status = 'failed', failure_reason = ?
    WHERE r2_key = ?
  `).bind(reason.slice(0, 500), key).run().catch(() => {});
}
