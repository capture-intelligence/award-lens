/** Shared types for the 3-tier AI router. */

export type Intent     = 'sql_query' | 'similar_awards' | 'reasoning_local' | 'general';
export type ModelTag   = 'M1' | 'M2' | 'M3';
export type DataClass  = 'INTERNAL' | 'PUBLIC';
export type AuditStatus = 'success' | 'error';

export interface AuditFields {
  userId:        string | null;
  questionHash:  string;
  intent:        Intent;
  model:         ModelTag;
  modelId:       string;
  promptTokens?: number;
  outputTokens?: number;
  durationMs?:   number;
  status:        AuditStatus;
  errorMessage?: string;
  dataClass:     DataClass;
}

/** Optional award context sent by the UI when the user is viewing a specific award. */
export interface AwardContext {
  award_id?:        string;
  naics_code?:      string;
  psc_code?:        string;
  psc_description?: string;
  description?:     string;
}

/** What the /ai/v2/ask endpoint returns. */
export interface AskResponse {
  intent:   Intent;
  sql?:     string;
  rows?:    unknown[][];
  cols?:    string[];
  /** For sql_query: the total row count behind `rows` (which is
   *  LIMIT-50'd). Decoupled from the projection so a single user
   *  question always yields both an aggregate ("44 contracts") and a
   *  visible sample ("here are the first 50") off one WHERE clause. */
  count?:   number;
  summary?: string;
  answer?:  string;          // M3 general response
  error?:   string;
  audit_ids: number[];       // inserted audit row ids
}
