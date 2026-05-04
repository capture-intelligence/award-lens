/**
 * Deterministic entity-filter enforcement.
 *
 * Even with the RESOLVED ENTITIES block in M1's prompt, the LoRA
 * sometimes drops the vendor filter (especially when the user's
 * agency-picker scope is also active in the question — M1 conflates
 * scope and entity, applies one, drops the other). The result is a
 * COUNT that returns "all contracts in scope", not "vendor X's
 * contracts in scope".
 *
 * This module post-processes M1's SQL: for each resolved entity we
 * detect whether the corresponding filter is already present, and if
 * not we splice an AND clause into the WHERE — preserving any trailing
 * GROUP BY / ORDER BY / LIMIT.
 *
 * Only vendor and center entities are enforced here (organization
 * entities tend to overlap with the agency-picker scope and double-
 * filtering an org canonical_name is rarely wrong but mostly redundant).
 */

import type { ResolvedEntity } from './aliases.js';

/** Splice extra AND-clauses into a SELECT, preserving any trailing
 *  GROUP BY / ORDER BY / LIMIT / OFFSET / semicolon. */
export function injectAndClauses(sql: string, clauses: string[]): string {
  if (clauses.length === 0) return sql;

  // Strip trailing ; for surgery; restore at the end.
  const trailingSemicolon = /;\s*$/.test(sql);
  let body = sql.replace(/;\s*$/, '').trimEnd();

  // Pull off GROUP BY / ORDER BY / LIMIT / OFFSET as a single suffix.
  // The regex looks for the start of any of those clauses at the top
  // level; it's not a full SQL parser but handles every shape M1
  // emits in practice.
  const SUFFIX_RE = /\s+(GROUP\s+BY\s+[\s\S]*|ORDER\s+BY\s+[\s\S]*|LIMIT\s+\d+(\s+OFFSET\s+\d+)?)$/i;
  let suffix = '';
  const suffixMatch = body.match(SUFFIX_RE);
  if (suffixMatch) {
    suffix = ` ${suffixMatch[1]}`;
    body  = body.slice(0, suffixMatch.index).trimEnd();
  }

  const filterClause = clauses.join(' AND ');
  const hasWhere = /\bWHERE\b/i.test(body);
  body = hasWhere
    ? `${body} AND ${filterClause}`
    : `${body} WHERE ${filterClause}`;

  return `${body}${suffix}${trailingSemicolon ? ';' : ''}`;
}

/** SQL-escape a single-quoted literal. */
function esc(s: string): string {
  return s.replace(/'/g, "''");
}

/** Detect whether SQL already filters by a specific vendor entity.
 *  We accept any of: vendor_id equality, legal_name LIKE the canonical
 *  name's first significant word, or legal_name LIKE the alias itself. */
function hasVendorFilter(sql: string, entity: ResolvedEntity): boolean {
  if (!entity.canonical_id) return true;
  const id = entity.canonical_id;
  // 1. vendor_id = '<id>'
  const idRe = new RegExp(`vendor_id\\s*=\\s*['"\`]${id.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&')}['"\`]`, 'i');
  if (idRe.test(sql)) return true;
  // 2. legal_name / common_name LIKE %X% with X being either the alias
  //    or the first significant word of the canonical name.
  const firstWord = entity.canonical_name.split(/\s+/)[0] ?? '';
  const candidates = [entity.alias, firstWord, entity.canonical_name].filter(Boolean);
  for (const c of candidates) {
    const safe = c.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
    const re = new RegExp(`(legal_name|common_name)\\s+LIKE\\s+['"\`]%[^'"\`]*${safe}[^'"\`]*%['"\`]`, 'i');
    if (re.test(sql)) return true;
  }
  return false;
}

/** Detect whether SQL already filters by a specific CDC center.
 *  Looks for cc.center_code = '<code>' or any reference to the
 *  cdc_center / cdc_center_override tables paired with the code. */
function hasCenterFilter(sql: string, entity: ResolvedEntity): boolean {
  if (!entity.canonical_id) return true;
  const code = entity.canonical_id;
  const safe = code.replace(/[-/\\^$*+?.()|[\]{}]/g, '\\$&');
  const re = new RegExp(`center_code\\s*=\\s*['"\`]${safe}['"\`]`, 'i');
  return re.test(sql);
}

/** Build the AND clause that filters to a specific vendor by vendor_id. */
function vendorClause(entity: ResolvedEntity): string {
  return `v.vendor_id = '${esc(entity.canonical_id ?? '')}'`;
}

/** Build the AND clause that filters to a specific CDC center using
 *  the canonical override-aware pattern from M1's prompt. */
function centerClause(code: string): string {
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

/**
 * Append filters for any resolved entity whose filter is missing from
 * the SQL. Returns the augmented SQL (or the original, if nothing was
 * missing).
 *
 * Reports which entities required injection so the caller can audit /
 * surface this in the response if useful.
 */
export interface InjectResult {
  sql:      string;
  injected: Array<{ kind: string; alias: string; canonical: string }>;
}

export function enforceResolvedEntities(
  sql: string,
  entities: ReadonlyArray<ResolvedEntity>,
): InjectResult {
  const clauses: string[] = [];
  const injected: InjectResult['injected'] = [];

  for (const e of entities) {
    if (!e.canonical_id) continue;

    if (e.entity_kind === 'vendor') {
      if (!hasVendorFilter(sql, e)) {
        clauses.push(vendorClause(e));
        injected.push({ kind: 'vendor', alias: e.alias, canonical: e.canonical_name });
      }
    } else if (e.entity_kind === 'center') {
      if (!hasCenterFilter(sql, e)) {
        clauses.push(centerClause(e.canonical_id));
        injected.push({ kind: 'center', alias: e.alias, canonical: e.canonical_id });
      }
    }
    // organization filters intentionally not enforced — too overlap-prone
    // with the agency-picker scope.
  }

  return { sql: injectAndClauses(sql, clauses), injected };
}
