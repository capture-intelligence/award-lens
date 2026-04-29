/**
 * Discovery — read awarding offices AND federal accounts already observed
 * for a view's awards (populated by the sidecar's per-award enrichment) and
 * return ranked tallies for admin review.
 *
 *   POST /admin/views/:id/discover-offices
 *   resp: {
 *     offices: Array<{ code, name, award_count, total_value, sample_piids }>,
 *     federal_accounts: Array<{ code, name, program_activity_codes,
 *                               award_count, total_value, sample_piids }>,
 *     total_in_view: number,
 *     missing_office_count: number,
 *     missing_federal_account_count: number
 *   }
 *
 * Read-only; admin promotes selections via PUT /admin/views/:id with
 *   filters.office_names = [...]            (less precise — CDC offices share)
 *   filters.federal_account_codes = [...]   (precise — center-level)
 *
 * Why local-only: USAspending's /search/spending_by_award/ doesn't surface
 * either field; the sidecar enriches per-award via /awards/{id}/ and
 * /awards/funding/. Local DB is canonical and much faster than re-sampling.
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

  // Federal-account tally — the precise center-level filter for CDC.
  // Aggregates by federal_account; rolls up the distinct program_activity
  // tuples observed against each one (a single account often spans
  // multiple program activities).
  const accountTally = await c.env.DB.prepare(`
    SELECT
      afa.federal_account_code AS code,
      MAX(afa.federal_account_name) AS name,
      COUNT(DISTINCT a.award_id) AS award_count,
      ROUND(SUM(COALESCE(a.current_value, 0)), 2) AS total_value
    FROM view_award va
    JOIN award a               ON a.award_id = va.award_id
    JOIN award_federal_account afa ON afa.award_id = a.award_id
    WHERE va.view_id = ?
    GROUP BY afa.federal_account_code
    ORDER BY award_count DESC, total_value DESC
  `).bind(viewId).all<{ code: string; name: string | null; award_count: number; total_value: number }>();

  // Program activities per federal account.
  const programActivities = await c.env.DB.prepare(`
    SELECT DISTINCT
      afa.federal_account_code AS code,
      afa.program_activity_code AS pa_code,
      afa.program_activity_name AS pa_name
    FROM view_award va
    JOIN award_federal_account afa ON afa.award_id = va.award_id
    WHERE va.view_id = ?
      AND afa.program_activity_code IS NOT NULL
      AND afa.program_activity_code != ''
  `).bind(viewId).all<{ code: string; pa_code: string; pa_name: string | null }>();

  const paByAccount = new Map<string, Array<{ code: string; name: string | null }>>();
  for (const row of programActivities.results) {
    const list = paByAccount.get(row.code) ?? [];
    if (!list.find((x) => x.code === row.pa_code)) list.push({ code: row.pa_code, name: row.pa_name });
    paByAccount.set(row.code, list);
  }

  // Sample PIIDs per federal account (most-recent end date first).
  const accountSamples = await c.env.DB.prepare(`
    SELECT
      afa.federal_account_code AS code,
      a.award_piid
    FROM view_award va
    JOIN award a               ON a.award_id = va.award_id
    JOIN award_federal_account afa ON afa.award_id = a.award_id
    WHERE va.view_id = ?
      AND a.award_piid IS NOT NULL
    ORDER BY a.pop_end_date DESC NULLS LAST
  `).bind(viewId).all<{ code: string; award_piid: string }>();

  const accountPiids = new Map<string, string[]>();
  for (const row of accountSamples.results) {
    const list = accountPiids.get(row.code) ?? [];
    if (list.length < 3 && !list.includes(row.award_piid)) {
      list.push(row.award_piid);
      accountPiids.set(row.code, list);
    }
  }

  const federal_accounts = accountTally.results.map((row) => ({
    code: row.code,
    name: row.name,
    program_activities: paByAccount.get(row.code) ?? [],
    award_count: row.award_count,
    total_value: row.total_value,
    sample_piids: accountPiids.get(row.code) ?? [],
  }));

  // Tell the admin how complete enrichment is on this view.
  const counts = await c.env.DB.prepare(`
    SELECT
      COUNT(*) AS total_in_view,
      SUM(CASE WHEN a.awarding_office_id IS NULL THEN 1 ELSE 0 END) AS missing_office_count,
      SUM(CASE WHEN NOT EXISTS (SELECT 1 FROM award_federal_account WHERE award_id = a.award_id)
               THEN 1 ELSE 0 END) AS missing_federal_account_count
    FROM view_award va
    JOIN award a ON a.award_id = va.award_id
    WHERE va.view_id = ?
  `).bind(viewId).first<{
    total_in_view: number;
    missing_office_count: number;
    missing_federal_account_count: number;
  }>();

  return c.json({
    offices,
    federal_accounts,
    total_in_view: counts?.total_in_view ?? 0,
    missing_office_count: counts?.missing_office_count ?? 0,
    missing_federal_account_count: counts?.missing_federal_account_count ?? 0,
  });
});
