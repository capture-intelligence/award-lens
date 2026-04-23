import type { CanonicalAward } from '../models/canonical.js';

/**
 * Raw record pulled from a source before validation.
 * Stored to R2; the key is persisted in `staging_raw_record.r2_key`.
 */
export interface RawRecord {
  endpoint: string;
  requestParams: Record<string, unknown>;
  response: unknown;
  responseHash: string;
}

export interface FetchWindow {
  since: string; // ISO datetime
  until: string; // ISO datetime
}

/**
 * Every data source implements this interface.
 * Adding a new source = implementing this + registering in source_system.
 */
export abstract class BaseSourceAdapter {
  abstract readonly sourceId: string;

  abstract fetchPage(window: FetchWindow, page: number): Promise<{
    raw: RawRecord;
    hasMore: boolean;
    records: unknown[];
  }>;

  abstract parse(raw: RawRecord): CanonicalAward[];

  watermarkKey(): string {
    return `WATERMARK/${this.sourceId}/award_transactions`;
  }
}
