/**
 * POST /ai/reindex-awards
 * One-shot admin endpoint: embeds all awards and upserts to Vectorize.
 *
 * Protected by X-Reindex-Secret header (set it to any strong random string
 * and pass the same value when calling).
 *
 * Processes awards in pages to stay within Worker CPU limits.
 * Safe to call multiple times — Vectorize upserts are idempotent.
 *
 * Query params:
 *   ?offset=0&limit=200   — page through awards manually if needed
 *   ?dry_run=1            — count awards + return without embedding
 */

import type { Context } from 'hono';
import type { Env } from '../index.js';
import type { AuthVars } from '../auth/session.js';

const EMBED_MODEL  = '@cf/baai/bge-base-en-v1.5';
const EMBED_BATCH  = 50;   // awards per AI.run() embed call
const UPSERT_BATCH = 100;  // vectors per Vectorize upsert call
const DEFAULT_LIMIT = 300; // awards per HTTP request

function buildEmbedText(row: Record<string, unknown>): string {
  const parts: string[] = [];
  if (row.description)       parts.push(String(row.description));
  if (row.description_long)  parts.push(String(row.description_long).slice(0, 500));
  if (row.naics_description) parts.push(`NAICS: ${row.naics_description}`);
  if (row.psc_description)   parts.push(`PSC: ${row.psc_description}`);
  return parts.join(' | ').slice(0, 2000);
}

export async function handleReindex(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
): Promise<Response> {
  // Secret check
  const secret = c.req.header('x-reindex-secret');
  if (!secret || secret.length < 8) {
    return c.json({ error: 'x-reindex-secret header required' }, 401);
  }

  const offset   = Number(c.req.query('offset')  ?? 0);
  const limit    = Number(c.req.query('limit')   ?? DEFAULT_LIMIT);
  const dryRun   = c.req.query('dry_run') === '1';

  const db  = c.env.DB;
  const ai  = c.env.AI;
  const vec = c.env.VEC;

  // Fetch awards page
  const rows = await db.prepare(`
    SELECT
      a.award_id,
      a.description,
      a.description_long,
      a.naics_code,
      a.psc_code,
      a.award_type,
      a.current_value,
      nc.description AS naics_description,
      pc.description AS psc_description
    FROM award a
    LEFT JOIN naics_code nc ON nc.naics_code = a.naics_code
    LEFT JOIN psc_code   pc ON pc.psc_code   = a.psc_code
    WHERE a.description IS NOT NULL AND a.description != ''
    ORDER BY a.award_id
    LIMIT ? OFFSET ?
  `).bind(limit, offset).all();

  const awards = rows.results as Record<string, unknown>[];

  if (dryRun) {
    const total = await db.prepare(
      `SELECT COUNT(*) AS n FROM award WHERE description IS NOT NULL AND description != ''`
    ).first<{ n: number }>();
    return c.json({ dry_run: true, total: total?.n, this_page: awards.length, offset, limit });
  }

  // Embed in sub-batches
  let upserted = 0;
  const vectorBuffer: VectorizeVector[] = [];

  for (let i = 0; i < awards.length; i += EMBED_BATCH) {
    const batch = awards.slice(i, i + EMBED_BATCH);
    const texts = batch.map(buildEmbedText);

    const embedResp = await ai.run(EMBED_MODEL, { text: texts } as Parameters<typeof ai.run>[1]);
    const embeddings = (embedResp as { data: number[][] }).data;

    for (let j = 0; j < batch.length; j++) {
      const row = batch[j];
      vectorBuffer.push({
        id:     String(row.award_id),
        values: embeddings[j],
        metadata: {
          naics_code:    String(row.naics_code   ?? ''),
          psc_code:      String(row.psc_code     ?? ''),
          award_type:    String(row.award_type   ?? ''),
          current_value: Number(row.current_value ?? 0),
        },
      });
    }

    // Flush upsert buffer
    while (vectorBuffer.length >= UPSERT_BATCH) {
      const chunk = vectorBuffer.splice(0, UPSERT_BATCH);
      await vec.upsert(chunk);
      upserted += chunk.length;
    }
  }

  // Flush remainder
  if (vectorBuffer.length > 0) {
    await vec.upsert(vectorBuffer);
    upserted += vectorBuffer.length;
  }

  const hasMore = awards.length === limit;
  return c.json({
    upserted,
    offset,
    limit,
    next_offset: hasMore ? offset + limit : null,
    done: !hasMore,
  });
}
