/**
 * BullMQ queues — one queue per ingestion source. Each job is idempotent
 * (upsert by external ID), logs run-status to ingestion_run, and invalidates
 * any Redis caches it touches on success.
 *
 * Sources mirror the spec's data table:
 *   sam_opps, sam_forecasts, sam_assistance, sam_entity, sam_exclusions
 *   usaspending_idv, usaspending_prime, usaspending_sub, usaspending_grants
 *   grants_gov, dibbs (seed-only), sled_opps (seed-only), gao_protests (seed),
 *   gsa_labor (real), faa_labor (seed), nsn_dla (seed), sewp (seed),
 *   defense_programs (seed), it_dashboard (real), cfda (real), nia (seed),
 *   dod_budget (seed), news_rss (real), ma_seed (seed),
 *   ai_summarize, ai_embed, ai_match_score, ai_value_estimate
 */
import { Queue, Worker, type WorkerOptions } from 'bullmq';
import { bullmqRedis } from '../redis.js';

export const QUEUE_NAMES = [
  // Real ingestion (free public APIs)
  'sam_opps',
  'sam_forecasts',
  'sam_assistance',
  'sam_entity',
  'sam_exclusions',
  'usaspending_idv',
  'usaspending_prime',
  'usaspending_sub',
  'usaspending_grants',
  'grants_gov',
  'cfda',
  'it_dashboard',
  'gsa_labor',
  'news_rss',

  // Seeded sources (no scraping for $0 demo — fixtures regenerate on demand)
  'seed_dibbs',
  'seed_sled_opps',
  'seed_gao_protests',
  'seed_faa_labor',
  'seed_nsn',
  'seed_sewp',
  'seed_defense_programs',
  'seed_nia',
  'seed_dod_budget',
  'seed_capital_markets',

  // AI batch jobs (pre-compute at index time, never on-demand)
  'ai_summarize_opps',
  'ai_embed_opps',
  'ai_match_score',
  'ai_value_estimate',
  'ai_doc_text_extract',

  // Operational
  'alerts_dispatch',
  'exports_render',
  'reconcile',
  'aggregate_kpis',
] as const;

export type QueueName = typeof QUEUE_NAMES[number];

const queues = new Map<QueueName, Queue>();

export function getQueue(name: QueueName): Queue {
  let q = queues.get(name);
  if (!q) {
    q = new Queue(name, {
      connection: bullmqRedis,
      defaultJobOptions: {
        // Idempotency-friendly defaults; jobs are upsert-shaped so retry is safe.
        attempts: 3,
        backoff: { type: 'exponential', delay: 30_000 },
        removeOnComplete: { count: 100 },
        removeOnFail:     { count: 500 },
      },
    });
    queues.set(name, q);
  }
  return q;
}

export function allQueues(): Queue[] {
  for (const n of QUEUE_NAMES) getQueue(n);
  return [...queues.values()];
}

/** Standard worker factory — use for processor wiring in worker.ts. */
export function createWorker<T = unknown>(
  name: QueueName,
  processor: (job: { id?: string; name: string; data: T }) => Promise<unknown>,
  opts?: Partial<WorkerOptions>,
): Worker {
  return new Worker(name, processor as never, {
    connection: bullmqRedis,
    concurrency: 2,
    ...opts,
  });
}
