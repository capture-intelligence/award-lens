import { buildUpsertStatements, type UpsertMsg } from '@awards/core';

export interface Env {
  DB: D1Database;
}

/**
 * Upsert worker: consumes canonical DTOs and writes them atomically to D1.
 * Groups all statements per-award into a single `db.batch([...])` to keep
 * each award's writes transactional.
 */
export default {
  async queue(batch: MessageBatch<UpsertMsg>, env: Env): Promise<void> {
    for (const msg of batch.messages) {
      try {
        await writeBatch(env.DB, msg.body);
        msg.ack();
      } catch (err) {
        const reason = err instanceof Error ? err.message : String(err);
        console.error(`[upsert] batch failed (source=${msg.body.source}, run=${msg.body.runId}): ${reason}`);
        msg.retry({ delaySeconds: 30 });
      }
    }
  },

  async fetch(): Promise<Response> {
    return new Response('upsert-worker', { status: 200 });
  },
} satisfies ExportedHandler<Env>;

async function writeBatch(db: D1Database, body: UpsertMsg): Promise<void> {
  let upsertedCount = 0;

  for (const award of body.records) {
    const stmts = await buildUpsertStatements(db, body.source, award);
    await db.batch(stmts);
    upsertedCount++;
  }

  await db.prepare(`
    UPDATE ingestion_run
    SET rows_upserted = rows_upserted + ?
    WHERE run_id = ?
  `).bind(upsertedCount, body.runId).run();

  console.log(`[upsert] ran ${upsertedCount} award upserts for run ${body.runId}`);
}
