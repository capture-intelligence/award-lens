/**
 * /ai/v2/ask router — Configuration D, 3-tier architecture.
 * See docs/architecture/MODEL-ROUTING.md for the full spec.
 *
 * Flow:
 *   1. Classify intent (regex fast-path → similar_awards | sql_query | general)
 *   2. similar_awards → embed context.description → Vectorize top-K → D1 fetch → M2 summarize
 *   3. sql_query      → M1 generates SQL → execute against D1 → M2 summarizes
 *   4. general        → M3 answers directly (no warehouse data sent)
 *   5. Each model call gets an ai_audit row.
 */

import type { Context } from 'hono';
import type { D1Database }  from '@cloudflare/workers-types';
import type { Env }         from '../index.js';
import type { AuthVars }    from '../auth/session.js';
import type { Intent, AskResponse, AwardContext } from './types.js';
import { callM1, M1_MODEL_ID } from './m1_sql.js';
import { callM2, M2_MODEL_ID } from './m2_local.js';
import { callM3, M3_MODEL_ID, polishSqlWithClaude, polishSqlWithWorkersAI } from './m3_external.js';
import { resolveEntities } from './aliases.js';
import { splitCountAndRows } from './sql_split.js';
import { recordAudit, hashQuestion } from './audit.js';

const EMBED_MODEL = '@cf/baai/bge-base-en-v1.5';

// ── Intent classifier ──────────────────────────────────────────────────────

const GENERAL_OVERRIDE = [
  /\b(FAR|DFARS|GSAM|FPDS|SAM\.gov|acquisition regulation)\b/i,
  /\b(simplified acquisition threshold|micro.?purchase threshold|source selection criterion|past performance factor)\b/i,
  /\b(what (is|are) (a |an |the )?(FAR|DFARS|IDIQ|CPFF|LPTA|BPA|GWAC|MATOC|SAT|MPT)\b)/i,
];

// Similarity triggers — only active when context is present.
//
// The third pattern catches typo-ridden phrasings like
//   "find more contracts link this one"      ("link" for "like")
//   "more awards lyke these"                  ("lyke" for "like")
//   "any more contracts related-wise to this contract"
// by anchoring on the demonstrative tail ("this one" / "this contract" /
// "these"), which is the actual signal that the user is asking about the
// focused award. The demonstrative is restricted to specific nouns
// ({one,contract,award,deal,opportunity}) so temporal phrases like
// "more contracts this year" don't false-positive.
const SIMILAR_PATTERNS = [
  /\b(similar|like this|like these|related to this|more like|find me others|find similar)\b/i,
  /\b(same type|same category|comparable|alternatives to this)\b/i,
  /\b(more|other|additional)\s+\w+(?:\s+\w+){0,3}\s+(this\s+(?:one|contract|award|deal|opportunity)|these|it)\b/i,
];

// "What is this contract about" / "describe this award" / "summarize this"
// — interpretive questions about the *currently focused* award. When an
// award context is present these go to M3 (with the context attached) so
// Claude can explain the contract in natural language. Without this rule
// they fall through to SQL classification because they contain words like
// "contract" / "award" that match the warehouse-domain pattern.
const ABOUT_THIS_PATTERNS = [
  /\b(what'?s|what is|tell me|describe|explain|summari[sz]e|overview)\b[^?]*?\b(this|it)\b/i,
  /\babout\s+this\b/i,
  /\bwhat'?s\s+this\s+(contract|award|deal|opportunity)\s+(all\s+)?about\b/i,
];

// Concrete warehouse signals — a SQL classification requires at least one of
// these. A bare verb prefix ("who is X", "what is Y", "list X") alone is NOT
// enough, because the warehouse only knows about awards/vendors/agencies —
// not people, regulations, or general definitions. Without a domain anchor
// a "who" question is general knowledge → M3.
const SQL_SIGNAL_PATTERNS = [
  /\b(award|vendor|agency|naics|psc|opportunity|grant|contract|federal account|exclusion)/i,
  /\b(more like|similar to|expir|recompete|bid|incumbent|obligat|modif)/i,
  /\b(average|total|sum|per |group by|breakdown|distribution)/i,
];

function classifyIntent(q: string, hasContext: boolean): Intent {
  if (GENERAL_OVERRIDE.some(re => re.test(q))) return 'general';
  // Similarity intent only fires when the UI sends award context
  if (hasContext && SIMILAR_PATTERNS.some(re => re.test(q)))    return 'similar_awards';
  // "Describe / summarize / what is THIS contract" — interpret the focused
  // award rather than query the warehouse. Must precede the SQL check
  // because these questions also contain words like "contract" / "award".
  if (hasContext && ABOUT_THIS_PATTERNS.some(re => re.test(q))) return 'general';
  if (SQL_SIGNAL_PATTERNS.some(re => re.test(q))) return 'sql_query';
  return 'general';
}

// ── D1 execution ───────────────────────────────────────────────────────────

interface D1QueryResult {
  cols: string[];
  rows: unknown[][];
}

async function executeSQL(db: D1Database, sql: string): Promise<D1QueryResult> {
  const result = await db.prepare(sql).all();
  if (!result.results?.length) return { cols: [], rows: [] };

  const cols = Object.keys(result.results[0] as object);
  const rows = result.results.map(r => cols.map(c => (r as Record<string, unknown>)[c]));
  return { cols, rows };
}

// ── Vectorize similarity search ────────────────────────────────────────────

interface ChatScope {
  awarding_agency?: string;
  center_code?:     string; // reserved — center scoping is a separate epic
}

async function findSimilarAwards(
  ai: Ai,
  vec: VectorizeIndex,
  db: D1Database,
  ctx: AwardContext,
  question: string,
  scope: ChatScope | null,
  topK = 10,
): Promise<D1QueryResult> {
  // Build embed text from award context
  const embedText = [
    ctx.description     ?? '',
    ctx.naics_code      ? `NAICS: ${ctx.naics_code}` : '',
    ctx.psc_code        ? `PSC: ${ctx.psc_code}` : '',
    ctx.psc_description ? `PSC desc: ${ctx.psc_description}` : '',
  ].filter(Boolean).join(' | ').slice(0, 2000);

  // Embed
  const embedResp = await ai.run(EMBED_MODEL, { text: [embedText] } as Parameters<typeof ai.run>[1]);
  const queryVec  = (embedResp as { data: number[][] }).data[0];

  // Build optional filter — narrow to same NAICS if expiry/timing question present
  const hasExpiry = /expir|next \d+ (day|month|week)/i.test(question);

  // When the user's agency picker is active we need to over-fetch from
  // Vectorize, because many of the global top-K may be outside the agency
  // and will get filtered out in SQL. 99 candidates is the practical
  // ceiling — Vectorize caps topK at 100 when metadata isn't requested,
  // and at 50 when it is. We only read `id` off matches (no metadata,
  // no values), so we stay in the higher-cap path.
  const hasAgencyScope = !!scope?.awarding_agency;
  const candidateK     = hasAgencyScope ? 99 : topK;
  const queryOpts: VectorizeQueryOptions = { topK: candidateK + 1 };

  const matches = await vec.query(queryVec, queryOpts);

  // Exclude the source award itself, collect IDs
  const ids = matches.matches
    .filter(m => m.id !== ctx.award_id)
    .slice(0, candidateK)
    .map(m => m.id);

  if (!ids.length) return { cols: [], rows: [] };

  // Expiry / scope clauses
  const expiryClause = hasExpiry
    ? `AND a.pop_end_date BETWEEN date('now') AND date('now', '+6 months')`
    : '';
  const agencyClause = hasAgencyScope
    ? `AND o.canonical_name = '${scope!.awarding_agency!.replace(/'/g, "''")}'`
    : '';

  // Award IDs are internal UUIDs — safe to inline (not user input).
  // Agency name is escaped above; coming from a controlled-set picker.
  const idList = ids.map(id => `'${id.replace(/'/g, "''")}'`).join(', ');

  // organization is INNER-joined when an agency scope is present, so the
  // agency clause actually filters. Without scope the LEFT JOIN preserves
  // rows whose org row is missing.
  const orgJoin = hasAgencyScope
    ? 'INNER JOIN organization o ON o.org_id = a.awarding_org_id'
    : 'LEFT  JOIN organization o ON o.org_id = a.awarding_org_id';

  const sql = `
    SELECT
      a.award_id, a.award_piid, a.description,
      a.current_value, a.pop_end_date, a.award_type,
      v.legal_name     AS vendor_name,
      o.canonical_name AS agency_name,
      nc.description   AS naics_description,
      pc.description   AS psc_description
    FROM award a
    LEFT JOIN vendor       v  ON v.vendor_id   = a.vendor_id
    ${orgJoin}
    LEFT JOIN naics_code   nc ON nc.naics_code  = a.naics_code
    LEFT JOIN psc_code     pc ON pc.psc_code    = a.psc_code
    WHERE a.award_id IN (${idList})
    ${agencyClause}
    ${expiryClause}
    ORDER BY a.pop_end_date ASC
    LIMIT ${topK};
  `;

  return executeSQL(db, sql.trim());
}

// ── Main handler ───────────────────────────────────────────────────────────

export async function handleAskV2(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
): Promise<Response> {
  const body = await c.req.json().catch(() => null) as {
    query?:   string;
    context?: AwardContext;
    scope?:   ChatScope;
  } | null;

  const question = String(body?.query ?? '').trim();
  if (!question || question.length > 1000) {
    return c.json({ error: 'query required, max 1000 chars' }, 400);
  }

  const ctx             = body?.context ?? null;
  const scope           = body?.scope   ?? null;
  const db              = c.env.DB;
  const ai              = c.env.AI;
  const vec             = c.env.VEC;
  const anthropicKey    = c.env.ANTHROPIC_API_KEY;
  const modalApiKey     = c.env.MODAL_API_KEY;
  const modalEndpoint   = c.env.MODAL_ENDPOINT_URL;
  const userId       = c.var.user?.user_id ?? null;
  const qHash        = await hashQuestion(question);
  const auditIds: number[] = [];

  const intent = classifyIntent(question, !!(ctx?.description || ctx?.award_id));

  // ── similar_awards path: embed context → Vectorize → D1 → table ──────────
  if (intent === 'similar_awards' && ctx) {
    let queryResult: D1QueryResult;
    try {
      queryResult = await findSimilarAwards(ai, vec, db, ctx, question, scope);
    } catch (err) {
      return c.json({
        intent, error: `Similarity search failed: ${String(err).slice(0, 200)}`,
        audit_ids: auditIds,
      } satisfies AskResponse, 500);
    }

    const { cols, rows } = queryResult;

    // The chat UI renders the rows as a table directly below the summary,
    // so the narrative should be a one-line header — anything more just
    // duplicates the table. M2 is skipped for this intent.
    const summary = 'Contracts with similar nature of work:';

    return c.json({ intent, cols, rows, summary, audit_ids: auditIds } satisfies AskResponse);
  }

  // ── sql_query path: M1 → Claude polish → execute → M2 ───────────────────
  if (intent === 'sql_query') {
    let sql: string;
    try {
      // Entity resolution — pull canonical names for any acronyms or
      // capitalized fragments the user typed (RTI, BAH, NCHHSTP, …).
      // Cheap D1 lookup against the precomputed entity_alias table.
      const entities = await resolveEntities(db, question).catch(() => []);
      const m1 = await callM1(question, ai, modalApiKey, modalEndpoint, {
        scope,
        entities,
      });
      sql = m1.sql;
      auditIds.push(await recordAudit(db, {
        userId, questionHash: qHash, intent, model: 'M1', modelId: M1_MODEL_ID,
        promptTokens: m1.promptTokens, outputTokens: m1.outputTokens,
        durationMs: m1.durationMs, status: 'success', dataClass: 'INTERNAL',
      }));

      // SQL polish — catches the wildcard / name-equality mistakes the
      // M1 LoRA still slips on. Tries Claude first, then falls back to
      // Workers AI Llama if Claude is rate-limited / 5xx / unreachable.
      // Original M1 SQL is preserved if BOTH fail. ~0.6-1.5s warm.
      let polished: { sql: string; changed: boolean; promptTokens: number; outputTokens: number; durationMs: number } | null = null;
      let polishProvider: 'claude' | 'workers-ai' | null = null;
      let polishErrSummary = '';

      if (anthropicKey) {
        try {
          polished = await polishSqlWithClaude(sql, question, anthropicKey);
          polishProvider = 'claude';
        } catch (err) {
          polishErrSummary = `claude: ${String(err).slice(0, 240)}`;
        }
      }

      if (!polished) {
        try {
          polished = await polishSqlWithWorkersAI(sql, question, ai);
          polishProvider = 'workers-ai';
        } catch (err) {
          polishErrSummary += ` | workers-ai: ${String(err).slice(0, 240)}`;
        }
      }

      if (polished && polishProvider) {
        sql = polished.sql;
        auditIds.push(await recordAudit(db, {
          userId, questionHash: qHash, intent, model: 'M3',
          modelId: polishProvider === 'claude' ? M3_MODEL_ID : '@cf/meta/llama-3.1-8b-instruct',
          promptTokens: polished.promptTokens, outputTokens: polished.outputTokens,
          durationMs: polished.durationMs, status: 'success',
          dataClass: 'INTERNAL',
          errorMessage: `sql-polish[${polishProvider}]: ${polished.changed ? 'rewritten' : 'unchanged'}${polishErrSummary ? ` (${polishErrSummary})` : ''}`,
        }));
      } else if (polishErrSummary) {
        auditIds.push(await recordAudit(db, {
          userId, questionHash: qHash, intent, model: 'M3', modelId: M3_MODEL_ID,
          status: 'error',
          errorMessage: `sql-polish: ${polishErrSummary}`.slice(0, 500),
          dataClass: 'INTERNAL',
        }));
      }
    } catch (err) {
      const msg = String(err);
      auditIds.push(await recordAudit(db, {
        userId, questionHash: qHash, intent, model: 'M1', modelId: M1_MODEL_ID,
        status: 'error', errorMessage: msg.slice(0, 500), dataClass: 'INTERNAL',
      }));
      return c.json({ intent, error: `SQL generation failed: ${msg}`, audit_ids: auditIds } satisfies AskResponse, 500);
    }

    // Split M1's single SQL into a count query + a rows query off the
    // same WHERE clause. Eliminates the failure mode where "how many X"
    // and "show me all X" generated divergent SQL — they now share one
    // generated WHERE and we always return both halves.
    const split = splitCountAndRows(sql);

    let queryResult: D1QueryResult;
    let totalCount: number | undefined;
    try {
      if (split.split && split.countSql !== split.rowsSql) {
        const [rowsRes, countRes] = await Promise.all([
          executeSQL(db, split.rowsSql),
          executeSQL(db, split.countSql),
        ]);
        queryResult = rowsRes;
        // The count query always returns exactly one row, one column.
        const c0 = countRes.rows[0]?.[0];
        if (typeof c0 === 'number') totalCount = c0;
        else if (typeof c0 === 'string' && /^\d+$/.test(c0)) totalCount = Number(c0);
      } else {
        // Heuristic bailed (couldn't classify). Run the original once;
        // if it's an aggregate, the lone numeric cell is the total.
        queryResult = await executeSQL(db, sql);
        if (queryResult.cols.length === 1 && queryResult.rows.length === 1) {
          const v = queryResult.rows[0]?.[0];
          if (typeof v === 'number') totalCount = v;
          else if (typeof v === 'string' && /^\d+$/.test(v)) totalCount = Number(v);
        }
      }
    } catch (err) {
      return c.json({
        intent, sql, error: `SQL execution failed: ${String(err).slice(0, 200)}`,
        audit_ids: auditIds,
      } satisfies AskResponse, 422);
    }

    const { cols, rows } = queryResult;

    let summary: string | undefined;
    try {
      // Pass the total count (when known) into M2's question framing so
      // its summary phrasing stays consistent with what's actually in
      // the warehouse, regardless of the LIMIT 50 on the rows.
      const m2Question = totalCount != null
        ? `${question}\n\n[INTERNAL: total matching rows = ${totalCount}; ${rows.length} shown below.]`
        : question;
      const m2 = await callM2(m2Question, cols, rows, ai, modalApiKey, modalEndpoint);
      summary = m2.summary;
      auditIds.push(await recordAudit(db, {
        userId, questionHash: qHash, intent: 'reasoning_local',
        model: 'M2', modelId: M2_MODEL_ID,
        promptTokens: m2.promptTokens, outputTokens: m2.outputTokens,
        durationMs: m2.durationMs, status: 'success', dataClass: 'INTERNAL',
      }));
    } catch (err) {
      auditIds.push(await recordAudit(db, {
        userId, questionHash: qHash, intent: 'reasoning_local',
        model: 'M2', modelId: M2_MODEL_ID,
        status: 'error', errorMessage: String(err).slice(0, 500), dataClass: 'INTERNAL',
      }));
    }

    return c.json({
      intent, sql, cols, rows, count: totalCount, summary,
      audit_ids: auditIds,
    } satisfies AskResponse);
  }

  // ── general path: M3 (Anthropic, falls back to Workers AI) ────────────────
  try {
    const m3 = await callM3(question, anthropicKey, ctx);
    auditIds.push(await recordAudit(db, {
      userId, questionHash: qHash, intent, model: 'M3', modelId: M3_MODEL_ID,
      promptTokens: m3.promptTokens, outputTokens: m3.outputTokens,
      durationMs: m3.durationMs, status: 'success', dataClass: 'PUBLIC',
    }));
    return c.json({ intent, answer: m3.answer, audit_ids: auditIds } satisfies AskResponse);
  } catch (m3Err) {
    try {
      const t0 = Date.now();
      // Mirror the M3 context behavior on the fallback so questions like
      // "what is this contract about" still get an award-aware answer
      // when Anthropic is down or rate-limited.
      const fbUserMsg = ctx
        ? [
            'FOCUSED AWARD:',
            ctx.description     ? `Description: ${ctx.description}`         : '',
            ctx.naics_code      ? `NAICS code: ${ctx.naics_code}`           : '',
            ctx.psc_code        ? `PSC code: ${ctx.psc_code}`               : '',
            ctx.psc_description ? `PSC description: ${ctx.psc_description}` : '',
            '',
            `Question: ${question}`,
          ].filter(Boolean).join('\n')
        : question;
      const fbResp = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: 'You are a helpful assistant for federal procurement questions. When a FOCUSED AWARD block is present, the metadata is from public USAspending.gov records — discuss it freely. Be concise and cite regulation numbers when relevant.' },
          { role: 'user',   content: fbUserMsg },
        ],
        max_tokens: 512,
      } as Parameters<typeof ai.run>[1]);
      const answer = ((fbResp as { response?: string }).response ?? '').trim();
      auditIds.push(await recordAudit(db, {
        userId, questionHash: qHash, intent, model: 'M3', modelId: '@cf/meta/llama-3.1-8b-instruct',
        durationMs: Date.now() - t0, status: 'success', dataClass: 'PUBLIC',
      }));
      return c.json({ intent, answer, audit_ids: auditIds } satisfies AskResponse);
    } catch (_) {
      const msg = String(m3Err);
      auditIds.push(await recordAudit(db, {
        userId, questionHash: qHash, intent, model: 'M3', modelId: M3_MODEL_ID,
        status: 'error', errorMessage: msg.slice(0, 500), dataClass: 'PUBLIC',
      }));
      return c.json({ intent, error: `General answer failed: ${msg}`, audit_ids: auditIds } satisfies AskResponse, 500);
    }
  }
}
