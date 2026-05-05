/**
 * BullMQ worker process — runs alongside the API but in a separate Node
 * process via systemd (captureradar-worker.service).
 *
 * Wires processors for every queue. Phase 1 stubs each processor; real
 * source-specific code lands as we ingest each source.
 */
import { createWorker, QUEUE_NAMES } from './index.js';
import { loadEnv } from '../env.js';

loadEnv();

console.log('captureradar worker starting…');

for (const name of QUEUE_NAMES) {
  createWorker(name, async (job) => {
    console.log(`[${name}] job ${job.id ?? '?'} (${job.name}) started`);
    // Phase 1: each source gets its real processor. For now we no-op so the
    // queues exist + Bull Board renders + jobs can be enqueued and inspected.
    return { ok: true, note: 'placeholder processor — wire real handler' };
  });
  console.log(`worker registered for queue: ${name}`);
}

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM received, shutting down workers…');
  process.exit(0);
});
process.on('SIGINT', () => {
  console.log('SIGINT received, shutting down workers…');
  process.exit(0);
});
