/**
 * Scope resolution for data endpoints. Accepts EITHER:
 *   ?view_id=…   — legacy. Joins view_award (M2M) and applies filter_json.
 *   ?filter_id=… — new (PR1). No M2M join — filter_json expanded against the
 *                  full warehouse at query time. Same access-control workflow.
 *
 * Both branches enforce the same access policy (admin → all, regular user →
 * must have a 'granted' row). PR2 will cut callers over to filter_id and
 * retire the view branch.
 */

import type { Context } from 'hono';
import type { AppUser, AuthVars } from '../auth/session.js';
import { loadAccessibleView } from './routes.js';
import { loadAccessibleFilter } from '../filters/routes.js';
import { buildAwardWhere, type ViewFilters } from './filters.js';

export interface ViewScope {
  view_id: string;
  name: string;
  filters: ViewFilters;
}

export interface FilterScope {
  filter_id: string;
  name: string;
  filters: ViewFilters;
}

export type ScopeResult =
  | { kind: 'scoped'; view: ViewScope }      // legacy: M2M-tagged
  | { kind: 'filter'; filter: FilterScope }  // new: query-time expansion
  | { kind: 'unscoped' }                     // admin without scope param
  | { kind: 'error'; response: Response };

export async function resolveScope<B extends { DB: D1Database }>(
  c: Context<{ Bindings: B; Variables: AuthVars }>,
): Promise<ScopeResult> {
  const user = c.var.user as AppUser | undefined;
  if (!user) return { kind: 'error', response: c.json({ error: 'unauthenticated' }, 401) };

  const viewId = c.req.query('view_id');
  const filterId = c.req.query('filter_id');
  const isAdmin = user.role === 'admin';

  // filter_id takes precedence when both are sent (forward-compat default).
  if (filterId) {
    const f = await loadAccessibleFilter(c.env.DB, filterId, user.user_id, isAdmin);
    if (!f) return { kind: 'error', response: c.json({ error: 'filter_not_accessible' }, 403) };
    return { kind: 'filter', filter: f };
  }

  if (viewId) {
    const view = await loadAccessibleView(c.env.DB, viewId, user.user_id, isAdmin);
    if (!view) return { kind: 'error', response: c.json({ error: 'view_not_accessible' }, 403) };
    return { kind: 'scoped', view };
  }

  if (isAdmin) return { kind: 'unscoped' };

  return { kind: 'error', response: c.json({ error: 'view_id_or_filter_id_required' }, 400) };
}

/**
 * Compose a query targeting `v_award_current` (or anything that has the same
 * columns), constrained to the resolved scope.
 *
 * Caller passes:
 *   - `selectClause`        e.g. "SELECT * FROM v_award_current va"
 *   - `extraWhere` / `extraParams`  user filters (q, vendor, etc.)
 *   - `tail`                e.g. "ORDER BY current_value DESC LIMIT ?"  with `tailParams`
 *
 * Returns ready-to-prepare SQL + bound params in order.
 *
 * ⚠️ The selectClause must alias the source table as `va` so the view_award
 * JOIN can hang off it.
 */
export function composeAwardQuery(opts: {
  scope: ScopeResult;
  selectClause: string;
  extraWhere?: string;
  extraParams?: unknown[];
  tail: string;
  tailParams?: unknown[];
}): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let sql = opts.selectClause;
  const where: string[] = [];

  if (opts.scope.kind === 'scoped') {
    // Legacy view: M2M-tagged. Join view_award + apply soft filter clauses.
    sql += ' INNER JOIN view_award vw ON vw.award_id = va.award_id AND vw.view_id = ?';
    params.push(opts.scope.view.view_id);

    const { sql: viewWhere, params: viewParams } = buildAwardWhere(opts.scope.view.filters);
    if (viewWhere) {
      where.push(viewWhere);
      params.push(...viewParams);
    }
  } else if (opts.scope.kind === 'filter') {
    // New: query-time only. The full filter spec gets expanded into WHERE
    // clauses (federal_account_codes, naics, psc, value-range, end-date
    // window). Federal-account membership is enforced via subquery against
    // award_federal_account, since it's an M2M relationship.
    const f = opts.scope.filter.filters;

    // Subtier-strict — narrow to the canonical agency before the federal-
    // account join cuts further. Without this, an unscoped filter would let
    // (e.g.) Medicaid co-funded contracts from non-CDC awarders sneak in.
    if (f.subtier_agency_name) {
      sql += ' INNER JOIN organization scope_o ON scope_o.org_id = va.awarding_org_id AND scope_o.canonical_name = ?';
      params.push(f.subtier_agency_name);
    } else if (f.toptier_agency_name) {
      // Fall back to short_name match (USAspending adapter sets short_name=toptier).
      sql += ' INNER JOIN organization scope_o ON scope_o.org_id = va.awarding_org_id AND scope_o.short_name = ?';
      params.push(f.toptier_agency_name);
    }

    if (f.federal_account_codes?.length) {
      const placeholders = f.federal_account_codes.map(() => '?').join(',');
      where.push(`va.award_id IN (
        SELECT DISTINCT award_id FROM award_federal_account
        WHERE federal_account_code IN (${placeholders})
      )`);
      params.push(...f.federal_account_codes);
    }

    const { sql: softWhere, params: softParams } = buildAwardWhere(f);
    if (softWhere) {
      where.push(softWhere);
      params.push(...softParams);
    }
  }

  if (opts.extraWhere) {
    where.push(opts.extraWhere);
    params.push(...(opts.extraParams ?? []));
  }

  if (where.length) sql += ' WHERE ' + where.join(' AND ');
  sql += ' ' + opts.tail;
  params.push(...(opts.tailParams ?? []));

  return { sql, params };
}
