/**
 * Office discovery — read awarding offices already observed for a view's
 * awards (populated by the sidecar's per-award detail enrichment) and return
 * a ranked tally for admin review.
 *
 *   POST /admin/views/:id/discover-offices
 *   resp: { offices: Array<{
 *     code: string | null;
 *     name: string;
 *     award_count: number;
 *     total_value: number;
 *     sample_piids: string[];
 *   }>,
 *     total_in_view: number,
 *     missing_office_count: number   // awards in the view with NO office_id yet
 *   }
 *
 * Read-only; admin promotes selected office(s) via PUT /admin/views/:id with
 * filters.office_names = [...]. The next ingest's purgeOfficeMismatches will
 * then enforce the office filter at finalize.
 *
 * Why local-only: USAspending's /search/spending_by_award/ doesn't surface
 * awarding office on its rows (the field is accepted but always returns null),
 * and the sidecar enriches each award via /awards/{id}/. So by the time the
 * view has been ingested at least once with the new code path, the local DB
 * is the canonical source for office tallies — and it's much faster than
 * re-sampling USAspending.
 */

import { Hono } from 'hono';
import { requireAdmin, type AuthVars } from '../auth/session.js';

interface Env {
  DB: D1Database;
}
type Ctx = { Bindings: Env; Variables: AuthVars };

export const adminDiscoverOfficesApp = new Hono<Ctx>();
adminDiscoverOfficesApp.use('*', requireAdmin);

interface OfficeRow {
  code: string | null;
  name: string;
  award_count: number;
  total_value: number;
}

interface SamplePiidRow {
  fpds_office_code: string | null;
  office_name: string | null;
  award_piid: string | null;
}

adminDiscoverOfficesApp.post('/:id/discover-offices', async (c) => {
  const viewId = c.req.param('id');

  const v = await c.env.DB.prepare('SELECT view_id FROM data_view WHERE view_id = ?')
    .bind(viewId).first();
  if (!v) return c.json({ error: 'not_found' }, 404);

  // Ranked office tally over awards currently tagged into this view.
  const tally = await c.env.DB.prepare(`
    SELECT
      co.fpds_office_code AS code,
      co.name             AS name,
      COUNT(*)            AS award_count,
      ROUND(SUM(COALESCE(a.current_value, 0)), 2) AS total_value
    FROM view_award va
    JOIN award a              ON a.award_id    = va.award_id
    JOIN contracting_office co ON co.office_id = a.awarding_office_id
    WHERE va.view_id = ?
    GROUP BY co.office_id
    ORDER BY award_count DESC, total_value DESC
  `).bind(viewId).all<OfficeRow>();

  // Three sample PIIDs per office (most recent end date first).
  const samples = await c.env.DB.prepare(`
    SELECT
      co.fpds_office_code,
      co.name AS office_name,
      a.award_piid
    FROM view_award va
    JOIN award a              ON a.award_id    = va.award_id
    JOIN contracting_office co ON co.office_id = a.awarding_office_id
    WHERE va.view_id = ?
      AND a.award_piid IS NOT NULL
    ORDER BY a.pop_end_date DESC NULLS LAST
  `).bind(viewId).all<SamplePiidRow>();

  const piidsByOffice = new Map<string, string[]>();
  for (const s of samples.results) {
    const key = `${s.fpds_office_code ?? ''}|${s.office_name ?? ''}`;
    const list = piidsByOffice.get(key) ?? [];
    if (list.length < 3 && s.award_piid) {
      list.push(s.award_piid);
      piidsByOffice.set(key, list);
    }
  }

  const offices = tally.results.map((row) => {
    const key = `${row.code ?? ''}|${row.name}`;
    return {
      code: row.code,
      name: row.name,
      award_count: row.award_count,
      total_value: row.total_value,
      sample_piids: piidsByOffice.get(key) ?? [],
    };
  });

  // Tell the admin if some awards in the view aren't enriched yet — they may
  // want to wait for an ingest cycle (or click Run Now) before locking in
  // office_names so they don't accidentally exclude offices not yet observed.
  const counts = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total_in_view,
      SUM(CASE WHEN a.awarding_office_id IS NULL THEN 1 ELSE 0 END) AS missing_office_count
    FROM view_award va
    JOIN award a ON a.award_id = va.award_id
    WHERE va.view_id = ?
  `).bind(viewId).first<{ total_in_view: number; missing_office_count: number }>();

  return c.json({
    offices,
    total_in_view: counts?.total_in_view ?? 0,
    missing_office_count: counts?.missing_office_count ?? 0,
  });
});
