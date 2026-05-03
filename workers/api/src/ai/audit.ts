import type { D1Database } from '@cloudflare/workers-types';
import type { AuditFields } from './types.js';

/** Insert one row into ai_audit. Returns the new audit_id. */
export async function recordAudit(db: D1Database, f: AuditFields): Promise<number> {
  const ts = new Date().toISOString();
  const result = await db.prepare(`
    INSERT INTO ai_audit
      (ts, user_id, question_hash, intent, model, model_id,
       prompt_tokens, output_tokens, duration_ms,
       status, error_message, data_class)
    VALUES (?,?,?,?,?,?,?,?,?,?,?,?)
  `).bind(
    ts,
    f.userId,
    f.questionHash,
    f.intent,
    f.model,
    f.modelId,
    f.promptTokens ?? null,
    f.outputTokens ?? null,
    f.durationMs   ?? null,
    f.status,
    f.errorMessage ?? null,
    f.dataClass,
  ).run();
  return (result.meta as { last_row_id?: number }).last_row_id ?? 0;
}

/** sha256 hex of a string — uses the SubtleCrypto available in Workers. */
export async function hashQuestion(q: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(q));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
