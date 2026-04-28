/**
 * View-scope resolution for data endpoints.
 *
 * Every protected list endpoint takes a `?view_id=` query param. This helper
 * looks up the view (gated by access), and returns SQL fragments the caller
 * splices into queries against `award` / `v_award_current` / `v_vendor_rollup`.
 *
 * Policy:
 *   - Non-admin user MUST specify a view_id, AND must have a 'granted' row.
 *   - Admin: optional. Omit view_id to query unscoped (legacy behavior).
 */

import type { Context } from 'hono';
import type { AppUser, AuthVars } from '../auth/session.js';
import { loadAccessibleView } from './routes.js';
import { buildAwardWhere, type ViewFilters } from './filters.js';

export interface ViewScope {
  view_id: string;
  name: string;
  filters: ViewFilters;
}

export type ScopeResult =
  | { kind: 'scoped'; view: ViewScope }
  | { kind: 'unscoped' }              // admin without view_id
  | { kind: 'error'; response: Response };

export async function resolveScope<B extends { DB: D1Database }>(
  c: Context<{ Bindings: B; Variables: AuthVars }>,
): Promise<ScopeResult> {
  const user = c.var.user as AppUser | undefined;
  if (!user) return { kind: 'error', response: c.json({ error: 'unauthenticated' }, 401) };

  const viewId = c.req.query('view_id');
  const isAdmin = user.role === 'admin';

  if (viewId) {
    const view = await loadAccessibleView(c.env.DB, viewId, user.user_id, isAdmin);
    if (!view) return { kind: 'error', response: c.json({ error: 'view_not_accessible' }, 403) };
    return { kind: 'scoped', view };
  }

  if (isAdmin) return { kind: 'unscoped' };

  return { kind: 'error', response: c.json({ error: 'view_id_required' }, 400) };
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
    sql += ' INNER JOIN view_award vw ON vw.award_id = va.award_id AND vw.view_id = ?';
    params.push(opts.scope.view.view_id);

    const { sql: viewWhere, params: viewParams } = buildAwardWhere(opts.scope.view.filters);
    if (viewWhere) {
      where.push(viewWhere);
      params.push(...viewParams);
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
