/**
 * Derive a (count, rows) pair from a single M1-generated SELECT.
 *
 * Why: same question phrased two ways ("how many X" vs "show me all X")
 * was generating divergent SQL — different WHERE clauses, different
 * filters, sometimes returning 44 contracts vs 0. The fix is to commit
 * to ONE WHERE clause per request and run two queries off it: a COUNT
 * for the totals, a SELECT-with-LIMIT for the visible rows. Frontend
 * gets `{ count, cols, rows }` and renders the count in the summary
 * + the table underneath, no inconsistency possible.
 *
 * Heuristic — robust enough for 90% of M1 outputs, falls back to using
 * the original SQL for both halves when it can't classify the query
 * shape (so we never break a query the heuristic doesn't recognize):
 *
 *   M1 returned an aggregate (COUNT/SUM/AVG only in projection)
 *     → countSql  = original
 *     → rowsSql   = swap projection for canonical detail columns + LIMIT 50
 *
 *   M1 returned rows
 *     → countSql  = SELECT COUNT(*) FROM ( <original sans LIMIT/ORDER BY> )
 *     → rowsSql   = original, with LIMIT 50 enforced
 */

const DETAIL_COLUMNS = `
  a.award_id, a.award_piid, a.description,
  v.legal_name AS vendor_name,
  o.canonical_name AS agency_name,
  a.current_value, a.pop_start_date, a.pop_end_date
`.replace(/\s+/g, ' ').trim();

export interface SplitSql {
  countSql: string;
  rowsSql:  string;
  /** True when the heuristic split applied; false when both halves are
   *  identical to the input (the caller may then choose to skip one
   *  query to avoid duplicate execution). */
  split:    boolean;
}

/** Strip trailing ; for safe wrapping. */
function unterm(sql: string): string {
  return sql.replace(/;\s*$/, '').trim();
}

/** Detect a top-level aggregate-only projection (COUNT/SUM/AVG/MIN/MAX/TOTAL). */
function isAggregateOnly(projection: string): boolean {
  const trimmed = projection.trim();
  // Allow "COUNT(*)", "SUM(a.current_value)", "AVG(...)", optional "AS alias"
  // — but not a list with non-aggregate columns alongside.
  const re = /^(COUNT|SUM|AVG|MIN|MAX|TOTAL)\s*\([^)]*\)\s*(AS\s+[A-Za-z_][A-Za-z0-9_]*)?\s*$/i;
  return re.test(trimmed);
}

/** Strip a trailing ORDER BY / LIMIT / OFFSET from a SELECT. */
function stripOrderLimit(sql: string): string {
  let out = sql;
  out = out.replace(/\s+OFFSET\s+\d+\s*$/i, '');
  out = out.replace(/\s+LIMIT\s+\d+\s*$/i, '');
  out = out.replace(/\s+ORDER\s+BY\s+[^;]*?$/i, '');
  return out.trim();
}

/** Ensure the SELECT has a LIMIT clause; add LIMIT 50 if absent. */
function ensureLimit(sql: string, n = 50): string {
  if (/\bLIMIT\s+\d+\b/i.test(sql)) return sql;
  return `${sql} LIMIT ${n}`;
}

export function splitCountAndRows(rawSql: string): SplitSql {
  const sql = unterm(rawSql);

  // Multiple statements / WITH / non-SELECT — safest to bail out and
  // let the caller execute the original.
  const head = sql.toUpperCase().trimStart();
  if (!head.startsWith('SELECT')) {
    return { countSql: sql, rowsSql: sql, split: false };
  }

  // Extract the top-level projection (between the first SELECT and the
  // first FROM). This regex is intentionally simple — it falls down on
  // SELECTs that have a subquery in the projection, which we then bail
  // on.
  const m = sql.match(/^SELECT\s+(.*?)\s+FROM\s/is);
  if (!m) return { countSql: sql, rowsSql: sql, split: false };
  const projection = m[1];
  if (/\bSELECT\b/i.test(projection)) {
    // Subquery in the projection — heuristic isn't safe.
    return { countSql: sql, rowsSql: sql, split: false };
  }

  if (isAggregateOnly(projection)) {
    // M1 returned a count/sum. Build the rows query by swapping the
    // projection and forcing a LIMIT.
    const rowsSql = ensureLimit(
      sql.replace(/^SELECT\s+.*?\s+FROM\s/is, `SELECT ${DETAIL_COLUMNS} FROM `),
      50,
    );
    return { countSql: sql, rowsSql, split: true };
  }

  // M1 returned rows. Wrap as subquery to derive the total count, and
  // ensure the rows query has a LIMIT.
  const noOrderLimit = stripOrderLimit(sql);
  const countSql = `SELECT COUNT(*) AS total FROM (${noOrderLimit})`;
  const rowsSql  = ensureLimit(sql, 50);
  return { countSql, rowsSql, split: true };
}
