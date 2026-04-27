/**
 * Filter spec for a data_view.
 * Stored as JSON in data_view.filters_json.
 *
 * Note we use agency NAMES (not codes) — that's what USAspending's
 * /search/spending_by_award/ expects in its `agencies` filter block.
 */
export interface ViewFilters {
  /** USAspending toptier agency name (e.g. "Department of Health and Human Services"). */
  toptier_agency_name?: string;
  /** USAspending subtier agency name (e.g. "Centers for Disease Control and Prevention"). */
  subtier_agency_name?: string;
  /** USAspending awarding office codes — applied when present. */
  office_codes?: string[];
  /**
   * Free-text keywords for office-level scoping. Matched case-insensitively
   * against awarding_office_name OR description. Mixed with office_codes
   * via OR (recall over precision).
   */
  keywords?: string[];
  naics_codes?: string[];
  psc_codes?: string[];
  award_types?: string[];
  min_value?: number;
  max_value?: number;
  /** US state codes for place-of-performance filter (e.g. ["TX","GA"]). */
  pop_states?: string[];
  /**
   * History side of the contract-end-date window. Pull/show contracts whose
   * end date is no older than `today - lookback_months`.
   */
  lookback_months?: number;
  /**
   * Forward side of the contract-end-date window. Pull/show contracts whose
   * end date is no later than `today + forward_months`. Omit or 0 to mean
   * "no upper bound" (back-compat with the original lookback-only behavior).
   */
  forward_months?: number;
}

const ALLOWED_KEYS = new Set<keyof ViewFilters>([
  'toptier_agency_name',
  'subtier_agency_name',
  'office_codes',
  'keywords',
  'naics_codes',
  'psc_codes',
  'award_types',
  'min_value',
  'max_value',
  'pop_states',
  'lookback_months',
  'forward_months',
]);

/** Validate + normalize raw input (e.g. from admin form). Throws on invalid shape. */
export function parseFilters(raw: unknown): ViewFilters {
  if (raw == null || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('filters must be an object');
  }
  const out: ViewFilters = {};
  for (const [k, v] of Object.entries(raw as Record<string, unknown>)) {
    if (!ALLOWED_KEYS.has(k as keyof ViewFilters)) continue;

    switch (k) {
      case 'toptier_agency_name':
      case 'subtier_agency_name':
        if (v != null && typeof v !== 'string') throw new Error(`${k} must be string`);
        if (v) (out as Record<string, unknown>)[k] = String(v).trim();
        break;

      case 'office_codes':
      case 'keywords':
      case 'naics_codes':
      case 'psc_codes':
      case 'award_types':
      case 'pop_states': {
        if (v == null) break;
        if (!Array.isArray(v)) throw new Error(`${k} must be array`);
        const arr = v.map((x) => String(x).trim()).filter((s) => s.length > 0);
        if (arr.length > 0) (out as Record<string, unknown>)[k] = arr;
        break;
      }

      case 'min_value':
      case 'max_value':
      case 'lookback_months':
      case 'forward_months': {
        if (v == null || v === '') break;
        const n = Number(v);
        if (!Number.isFinite(n) || n < 0) throw new Error(`${k} must be non-negative number`);
        (out as Record<string, unknown>)[k] = n;
        break;
      }
    }
  }
  return out;
}

export function serializeFilters(f: ViewFilters): string {
  return JSON.stringify(f);
}

export function deserializeFilters(json: string | null | undefined): ViewFilters {
  if (!json) return {};
  try {
    const raw = JSON.parse(json);
    return parseFilters(raw);
  } catch {
    return {};
  }
}

/**
 * Build a SQL WHERE fragment that, when conjoined with the caller's existing
 * filters, restricts results to awards matching this view.
 *
 * IMPORTANT: agency / subtier / office_codes / keywords are NOT applied here.
 * Those are baked in at INGEST TIME by the sidecar — when the sidecar pulls
 * USAspending with the view's scope, every fetched award is paired with the
 * view via view_award. Query-time then joins through view_award.
 *
 * What IS applied here is the "soft" filter set — values that should reflect
 * dynamically when the admin tunes them, without re-ingesting:
 *   - lookback_months  (sliding window)
 *   - min_value, max_value
 *   - naics_codes, psc_codes, award_types
 *
 * Returns SQL referencing `award` columns (or v_award_current columns, which
 * are a superset). If `sql` is empty, no extra filter applies.
 */
export function buildAwardWhere(f: ViewFilters): { sql: string; params: unknown[] } {
  const clauses: string[] = [];
  const params: unknown[] = [];

  if (f.naics_codes?.length) {
    clauses.push(`naics_code IN (${placeholders(f.naics_codes.length)})`);
    params.push(...f.naics_codes);
  }
  if (f.psc_codes?.length) {
    clauses.push(`psc_code IN (${placeholders(f.psc_codes.length)})`);
    params.push(...f.psc_codes);
  }
  // award_types is intentionally NOT applied at query time. The sidecar
  // already restricts the USAspending request body via `award_type_codes`
  // (A/B/C/D for contracts, 02-05 for grants), so view_award only contains
  // the right rows. Query-time would have to map codes → labels (e.g. "C"
  // → "DELIVERY ORDER") because USAspending stores the label, not the code,
  // on the `award` row — too brittle to be worth the rerun-free flexibility.
  if (typeof f.min_value === 'number') {
    clauses.push('current_value >= ?');
    params.push(f.min_value);
  }
  if (typeof f.max_value === 'number') {
    clauses.push('current_value <= ?');
    params.push(f.max_value);
  }
  // Contract-end-date window: `pop_end_date BETWEEN today - lookback AND today + forward`.
  //   - lookback only  → pop_end_date >= today - lookback (back-compat: open future)
  //   - forward only   → pop_end_date <= today + forward
  //   - both           → bounded window
  // Awards with no end date pass through (open-ended IDVs / data gaps).
  const hasLookback = typeof f.lookback_months === 'number' && f.lookback_months > 0;
  const hasForward  = typeof f.forward_months  === 'number' && f.forward_months  > 0;
  if (hasLookback && hasForward) {
    clauses.push(
      `(pop_end_date IS NULL
         OR date(pop_end_date) BETWEEN date('now', ?) AND date('now', ?))`,
    );
    params.push(`-${f.lookback_months} months`, `+${f.forward_months} months`);
  } else if (hasLookback) {
    clauses.push(`(pop_end_date IS NULL OR date(pop_end_date) >= date('now', ?))`);
    params.push(`-${f.lookback_months} months`);
  } else if (hasForward) {
    clauses.push(`(pop_end_date IS NULL OR date(pop_end_date) <= date('now', ?))`);
    params.push(`+${f.forward_months} months`);
  }

  if (clauses.length === 0) return { sql: '', params: [] };
  return { sql: clauses.join(' AND '), params };
}

function placeholders(n: number): string {
  return Array.from({ length: n }, () => '?').join(',');
}
