/**
 * M3 — External Generalist.
 * Calls the Anthropic API (claude-sonnet-4-5) for general-knowledge questions
 * and for interpreting the public metadata of a focused award.
 *
 * Privacy contract: M3 may receive a small set of PUBLIC award fields
 * (award_id, description, naics_code, psc_code, psc_description) when the
 * user is viewing a specific award. These come straight from
 * USAspending.gov, which is itself a public dataset. M3 never sees private
 * vendor scoring, internal notes, or any field flagged INTERNAL — see
 * MODEL-ROUTING.md §2.
 */

import type { AwardContext } from './types.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
export const M3_MODEL_ID = 'claude-sonnet-4-5';

const SYSTEM = `You are a helpful assistant embedded in a federal procurement dashboard. You answer general questions about federal contracting, acquisition regulations, agency structures, and procurement concepts.

When the user is viewing a specific award, the message will include a "FOCUSED AWARD" block with public metadata for that award (description, NAICS code, PSC code, PSC description). You may discuss this freely — it's all from USAspending.gov public records. Use it to interpret what the contract is about, what category of work it covers, and what kind of vendor would typically perform it.

For warehouse-wide statistical questions ("how many awards does NASA have?") tell the user to ask about their data directly — those go to a different model.

Be concise. Cite regulation numbers (FAR, DFARS, etc.) when relevant.`;

export interface M3Result {
  answer: string;
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
}

function formatContext(ctx: AwardContext): string {
  const lines: string[] = ['FOCUSED AWARD:'];
  if (ctx.description)     lines.push(`Description: ${ctx.description}`);
  if (ctx.naics_code)      lines.push(`NAICS code: ${ctx.naics_code}`);
  if (ctx.psc_code)        lines.push(`PSC code: ${ctx.psc_code}`);
  if (ctx.psc_description) lines.push(`PSC description: ${ctx.psc_description}`);
  return lines.join('\n');
}

/**
 * SQL-polish pass — Claude reviews M1's candidate SQL and fixes the
 * common-bug patterns M1 still misses (most importantly: name fields
 * compared with = instead of LIKE '%X%'). Returns the corrected SQL or
 * the original if Claude's response wasn't a clean SELECT.
 *
 * Privacy note: Claude sees the SQL string + the user's natural-language
 * question. No warehouse rows, no PII, no internal-class fields.
 */
export interface PolishResult {
  sql:          string;
  changed:      boolean;
  promptTokens: number;
  outputTokens: number;
  durationMs:   number;
}

const POLISH_SYSTEM = `You review SQL written by another model for an awards warehouse and return a corrected version. The schema includes: award (a), vendor (v), organization (o), naics_code (nc), psc_code (pc), award_federal_account (afa).

Your single most important job is to enforce wildcard name matching. The warehouse stores full legal names like "LANTANA CONSULTING GROUP", "BOOZ ALLEN HAMILTON INC", "Centers for Disease Control and Prevention". Users type fragments ("Lantana", "BAH", "CDC", "NCHHSTP"). Any of these patterns is wrong and must be rewritten:
  o.canonical_name = 'X'   →   o.canonical_name LIKE '%X%'
  o.short_name = 'X'       →   o.short_name LIKE '%X%'
  v.legal_name = 'X'       →   v.legal_name LIKE '%X%'
  nc.description = 'X'     →   nc.description LIKE '%X%'
  pc.description = 'X'     →   pc.description LIKE '%X%'
Codes (naics_code, psc_code, federal_account_code) keep =.

Other fixes welcome but lower priority: redundant subqueries that re-look-up an organization the query already JOINed, missing ORDER BY / LIMIT on list queries, COUNT/SUM where the user clearly wanted rows.

Return ONLY the corrected SQL ending with ;. No markdown fences, no explanation. If the SQL is already correct, return it unchanged.`;

export async function polishSqlWithClaude(
  sql: string,
  question: string,
  apiKey: string,
): Promise<PolishResult> {
  const t0 = Date.now();
  const userMsg = `User question: ${question}\n\nSQL to review:\n${sql}`;

  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      M3_MODEL_ID,
      max_tokens: 800,
      system:     POLISH_SYSTEM,
      messages:   [{ role: 'user', content: userMsg }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`Claude polish error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    content: { type: string; text: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  // Strip markdown fences if Claude added them despite instructions.
  let polished = data.content
    .filter((b) => b.type === 'text')
    .map((b) => b.text)
    .join('')
    .trim();
  const fenced = polished.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced) polished = fenced[1].trim();

  // Safety: if the response doesn't look like a SELECT/WITH, fall back
  // to the original SQL so we never execute garbage.
  const head = polished.toUpperCase().trimStart();
  const looksValid = head.startsWith('SELECT') || head.startsWith('WITH');

  return {
    sql:          looksValid ? polished : sql,
    changed:      looksValid && polished.replace(/\s+/g, ' ').trim() !== sql.replace(/\s+/g, ' ').trim(),
    promptTokens: data.usage?.input_tokens  ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    durationMs:   Date.now() - t0,
  };
}

export async function callM3(
  question: string,
  apiKey: string,
  awardContext?: AwardContext | null,
): Promise<M3Result> {
  const t0 = Date.now();

  const userMsg = awardContext
    ? `${formatContext(awardContext)}\n\nQuestion: ${question}`
    : question;

  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      M3_MODEL_ID,
      max_tokens: 1024,
      system:     SYSTEM,
      messages: [{ role: 'user', content: userMsg }],
    }),
  });

  if (!resp.ok) {
    const body = await resp.text();
    throw new Error(`M3 Anthropic error ${resp.status}: ${body.slice(0, 200)}`);
  }

  const data = await resp.json() as {
    content: { type: string; text: string }[];
    usage?: { input_tokens: number; output_tokens: number };
  };

  const answer = data.content
    .filter(b => b.type === 'text')
    .map(b => b.text)
    .join('');

  return {
    answer,
    promptTokens: data.usage?.input_tokens  ?? 0,
    outputTokens: data.usage?.output_tokens ?? 0,
    durationMs:   Date.now() - t0,
  };
}
