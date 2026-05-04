/**
 * Deterministic SQL builder for the well-defined common patterns —
 * skips M1 entirely when the question's intent and entities are
 * unambiguous. Eliminates whole classes of LoRA-flake bugs:
 *
 *   - dropped vendor filter when picker scope is also active
 *   - structurally-wrong cdc_center JOIN that cartesian-multiplies rows
 *   - "active" interpreted as IS NULL or with extra restrictive predicates
 *   - "show me all" diverging from "how many" on the same entities
 *
 * Returns null when the question doesn't match a supported pattern;
 * caller should fall through to the M1 + polish + inject pipeline.
 *
 * Supported shapes (all require at least one resolved vendor or center):
 *   "how many [active/expired] contracts does VENDOR have with CENTER"
 *   "show me all [active/expired] contracts VENDOR has with CENTER"
 *   "list [active/expired] contracts for VENDOR in CENTER"
 *   "count contracts under VENDOR in CENTER"
 *   "VENDOR contracts" / "contracts with CENTER"
 */

import type { ResolvedEntity } from './aliases.js';

interface ChatScope { awarding_agency?: string; center_code?: string }

const COUNT_RE = /\b(how\s+many|count|number\s+of|total\s+(number|count)\s+of)\b/i;
const LIST_RE  = /\b(show\s+(me\s+)?(all\s+)?|list\s+(all\s+)?|give\s+me\s+(all\s+)?|find|display|view)\b/i;

const ACTIVE_RE  = /\b(active|current|in.?progress|ongoing|live)\b/i;
const EXPIRED_RE = /\b(expired|past|finished|completed|closed|inactive)\b/i;

/** Single-quote escape for SQL literals. */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/** Canonical CDC-center filter (override-aware). */
function centerInClause(code: string): string {
  const safe = esc(code);
  return `a.award_id IN (
    SELECT a2.award_id FROM award a2
    JOIN cdc_center_override cco ON cco.award_piid = a2.award_piid
    WHERE cco.center_code = '${safe}'
    UNION
    SELECT award_id FROM (
      SELECT afa.award_id, cc.center_code,
             ROW_NUMBER() OVER (PARTITION BY afa.award_id ORDER BY cc.priority ASC) AS rn
      FROM award_federal_account afa
      JOIN cdc_center cc ON cc.federal_account_code = afa.federal_account_code
    ) WHERE rn = 1 AND center_code = '${safe}'
  )`;
}

export interface BuiltSql {
  sql: string;
  /** Plain-English description of what was matched, for audit / logs. */
  reason: string;
}

export function buildDeterministicSql(
  question: string,
  entities: ReadonlyArray<ResolvedEntity>,
  scope: ChatScope | null | undefined,
): BuiltSql | null {
  // Intent — must be a count or list shape, otherwise punt.
  const isCount = COUNT_RE.test(question);
  const isList  = LIST_RE.test(question);
  if (!isCount && !isList) return null;

  // Date qualifier — accept active/expired or none. If neither, the
  // user is asking about the lifetime universe, which is fine.
  let dateClause = '';
  let dateLabel  = 'all-time';
  if (ACTIVE_RE.test(question)) {
    dateClause = `a.pop_end_date >= date('now')`;
    dateLabel  = 'active';
  } else if (EXPIRED_RE.test(question)) {
    dateClause = `a.pop_end_date < date('now')`;
    dateLabel  = 'expired';
  }

  // Pull the strongest vendor / center hits from resolved entities. We
  // prefer entities that resolved to a canonical_id (those are the ones
  // we trust to filter exactly).
  const vendor = entities.find((e) => e.entity_kind === 'vendor' && e.canonical_id);
  const center = entities.find((e) => e.entity_kind === 'center' && e.canonical_id);

  // If the question doesn't name a specific entity AND the picker
  // doesn't give us a center either, M1 is in a better position to
  // figure out what's being asked.
  if (!vendor && !center && !scope?.center_code) return null;

  const filters: string[] = [];
  const reasonParts: string[] = [];

  if (vendor) {
    filters.push(`v.vendor_id = '${esc(vendor.canonical_id!)}'`);
    reasonParts.push(`vendor=${vendor.canonical_name}`);
  }

  // Center: question entity wins; otherwise fall back to picker.
  const effectiveCenter = center?.canonical_id ?? scope?.center_code;
  if (effectiveCenter) {
    filters.push(centerInClause(effectiveCenter));
    reasonParts.push(`center=${effectiveCenter}`);
  }

  if (dateClause) filters.push(dateClause);
  reasonParts.push(dateLabel);

  // Need at least the vendor or center to actually filter; otherwise
  // we'd be returning the entire warehouse to the user.
  if (filters.length === 0 || (!vendor && !effectiveCenter)) return null;

  const projection = isCount
    ? `COUNT(*) AS total`
    : `a.award_id, a.award_piid, a.description,
       v.legal_name      AS vendor_name,
       o.canonical_name  AS agency_name,
       a.current_value, a.pop_start_date, a.pop_end_date,
       nc.description    AS naics_description,
       pc.description    AS psc_description`;

  const tail = isCount ? '' : `ORDER BY a.pop_end_date DESC LIMIT 50`;

  const sql = `
    SELECT ${projection}
    FROM award a
    LEFT JOIN vendor       v  ON v.vendor_id   = a.vendor_id
    LEFT JOIN organization o  ON o.org_id      = a.awarding_org_id
    LEFT JOIN naics_code   nc ON nc.naics_code = a.naics_code
    LEFT JOIN psc_code     pc ON pc.psc_code   = a.psc_code
    WHERE ${filters.join(' AND ')}
    ${tail}
  `.replace(/\s+/g, ' ').trim();

  return {
    sql: `${sql};`,
    reason: `template[${isCount ? 'count' : 'list'}]: ${reasonParts.join(', ')}`,
  };
}
