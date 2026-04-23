import type { CanonicalAward } from '../models/canonical.js';

/**
 * Queue message envelopes. Keep these small — Queues has a 128 KB/message limit.
 * For large payloads, pass the R2 key and let the consumer fetch.
 */

export interface NormalizeMsg {
  source: string;         // 'usaspending' etc.
  runId: number;
  stagingKey: string;     // R2 object key
  recordCount: number;
}

export interface UpsertMsg {
  source: string;
  runId: number;
  records: CanonicalAward[];  // batched DTOs, keep batch <= 50
}

export interface SamEnrichMsg {
  uei: string;
  requestedBy?: string;
}
