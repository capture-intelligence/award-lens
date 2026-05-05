/**
 * Base ingestion job — subclassed per source. Handles the boilerplate every
 * job repeats: open an `ingestion_run` row at start, count rows, close it
 * with status + error summary at end.
 *
 * Subclasses implement `run()` and call `this.recordUpsert()` per record.
 */
import { db } from '../../db/index.js';
import { ingestion_run } from '../../db/schema/index.js';
import { eq } from 'drizzle-orm';

export interface JobContext {
  source_id: string;
  job_name: string;
  metadata?: Record<string, unknown>;
}

export abstract class BaseIngestionJob {
  protected runId!: number;
  private fetched = 0;
  private upserted = 0;
  private failed = 0;

  constructor(protected ctx: JobContext) {}

  abstract run(): Promise<void>;

  async execute(): Promise<{ runId: number; fetched: number; upserted: number; failed: number }> {
    // Open run
    const [row] = await db
      .insert(ingestion_run)
      .values({
        source_id: this.ctx.source_id,
        job_name:  this.ctx.job_name,
        status:    'running',
        metadata:  this.ctx.metadata ?? {},
      })
      .returning({ run_id: ingestion_run.run_id });
    this.runId = row.run_id;

    let status: 'success' | 'partial' | 'failed' = 'success';
    let error_summary: string | null = null;

    try {
      await this.run();
      if (this.failed > 0 && this.upserted > 0) status = 'partial';
      else if (this.failed > 0)                  status = 'failed';
    } catch (err) {
      status = 'failed';
      error_summary = err instanceof Error ? err.message : String(err);
      console.error(`job ${this.ctx.job_name} failed:`, err);
    }

    await db
      .update(ingestion_run)
      .set({
        finished_at:   new Date(),
        status,
        rows_fetched:  this.fetched,
        rows_upserted: this.upserted,
        rows_failed:   this.failed,
        error_summary,
      })
      .where(eq(ingestion_run.run_id, this.runId));

    return { runId: this.runId, fetched: this.fetched, upserted: this.upserted, failed: this.failed };
  }

  protected recordFetch(n = 1) { this.fetched += n; }
  protected recordUpsert(n = 1) { this.upserted += n; }
  protected recordFailure(n = 1) { this.failed += n; }
}
