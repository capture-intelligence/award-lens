/**
 * /ai/report-inaccuracy — user-submitted feedback on AI answers.
 *
 * Captures everything needed to investigate later: the original question,
 * the response shown, the user's description of what's wrong, what they
 * expected, and example(s) — plus the audit_id that links to the model
 * call's metadata (timing, tokens, model id) when available.
 */

import type { Context } from 'hono';
import type { Env }     from '../index.js';
import type { AuthVars } from '../auth/session.js';

const MAX_TEXT       = 4000;   // per free-text field
const MAX_RESPONSE   = 10_000; // serialized response payload
const MAX_QUESTION   = 1_000;

function clampStr(s: unknown, max: number): string {
  if (typeof s !== 'string') return '';
  return s.length > max ? s.slice(0, max) : s;
}

function safeStringify(v: unknown, max: number): string | null {
  if (v === null || v === undefined) return null;
  try {
    const s = JSON.stringify(v);
    return s.length > max ? s.slice(0, max) : s;
  } catch {
    return null;
  }
}

export async function handleReportInaccuracy(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
): Promise<Response> {
  const body = await c.req.json().catch(() => null) as {
    audit_id?:               number | null;
    intent?:                 string | null;
    question?:               string;
    actual_response?:        unknown;
    award_context?:          unknown;
    agency_scope?:           unknown;
    inaccuracy_description?: string;
    expected_outcome?:       string;
    examples?:               string;
  } | null;

  if (!body) return c.json({ error: 'invalid_json' }, 400);

  const question         = clampStr(body.question,               MAX_QUESTION);
  const inaccuracy       = clampStr(body.inaccuracy_description, MAX_TEXT);
  const expected         = clampStr(body.expected_outcome,       MAX_TEXT);
  const examples         = clampStr(body.examples,               MAX_TEXT);

  if (!question)   return c.json({ error: 'question required'              }, 400);
  if (!inaccuracy) return c.json({ error: 'inaccuracy_description required' }, 400);
  if (!expected)   return c.json({ error: 'expected_outcome required'       }, 400);

  const intent = body.intent === 'sql_query'
              || body.intent === 'similar_awards'
              || body.intent === 'general'
    ? body.intent
    : null;

  const auditId = typeof body.audit_id === 'number' && Number.isFinite(body.audit_id)
    ? body.audit_id
    : null;

  const userId  = c.var.user?.user_id ?? null;
  const ts      = new Date().toISOString();

  const result = await c.env.DB.prepare(
    `INSERT INTO ai_inaccuracy_report (
       ts, user_id, audit_id, intent, question,
       actual_response_json, award_context_json, agency_scope_json,
       inaccuracy_description, expected_outcome, examples, status
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'open')
     RETURNING report_id`,
  ).bind(
    ts,
    userId,
    auditId,
    intent,
    question,
    safeStringify(body.actual_response, MAX_RESPONSE),
    safeStringify(body.award_context,   MAX_TEXT),
    safeStringify(body.agency_scope,    MAX_TEXT),
    inaccuracy,
    expected,
    examples || null,
  ).first<{ report_id: number }>();

  return c.json({ report_id: result?.report_id ?? null });
}
