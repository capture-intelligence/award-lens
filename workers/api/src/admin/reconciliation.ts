import { nowIso } from '@awards/core';
import { backfillToptierCodes, countOrgsWithToptier } from './toptier-backfill.js';

/**
 * Reconciliation: cross-check warehouse totals against the source system's
 * own rollup APIs. Writes results to `reconciliation_check` so drift is
 * auditable over time.
 *
 * Current checks:
 *   - per toptier-agency total obligations for the current FY
 *     (warehouse SUM vs USAspending /agency/{code}/budgetary_resources/)
 */

const USASPENDING_BASE = 'https://api.usaspending.gov/api/v2';

interface AgencyWarehouseRow {
  short_name: string | null;
  canonical_name: string;
  toptier_code: string | null;
  num_awards: number;
  total_value: number;
}

export async function runReconciliation(
  db: D1Database,
  meta: KVNamespace,
): Promise<{ checksRun: number; driftCount: number; errors: number; toptierBackfilled?: number }> {
  const now = nowIso();
  const fy = fiscalYearFor(new Date(now));

  // Self-heal: if we have zero orgs with toptier codes, backfill first so the
  // reconciliation call below can actually query USAspending's agency rollup.
  let toptierBackfilled: number | undefined;
  if ((await countOrgsWithToptier(db)) === 0) {
    const b = await backfillToptierCodes(db);
    toptierBackfilled = b.matchedExact + b.matchedCaseInsensitive + b.matchedAlias;
    console.log(`[reconcile] backfilled ${toptierBackfilled} toptier codes (of ${b.totalAgencies} agencies)`);
  }

  // Open a reconciliation "run" to group the checks
  const runRow = await db.prepare(`
    INSERT INTO ingestion_run (source_id, started_at, status)
    VALUES ('reconciliation', ?, 'running')
    RETURNING run_id
  `).bind(now).first<{ run_id: number }>();
  if (!runRow) throw new Error('failed to open reconciliation run');
  const runId = runRow.run_id;

  // Pull the warehouse-side agency rollup (we only audit top 20 by volume)
  const agencies = await db.prepare(`
    SELECT
      o.short_name,
      o.canonical_name,
      json_extract(o.external_ids_json, '$.toptier_code') AS toptier_code,
      COUNT(a.award_id) AS num_awards,
      COALESCE(SUM(a.current_value), 0) AS total_value
    FROM organization o
    JOIN award a ON a.awarding_org_id = o.org_id
    WHERE o.parent_org_id IS NULL
    GROUP BY o.org_id, o.short_name, o.canonical_name, toptier_code
    HAVING total_value > 0
    ORDER BY total_value DESC
    LIMIT 20
  `).all<AgencyWarehouseRow>();

  let driftCount = 0;
  let errors = 0;

  for (const a of agencies.results) {
    try {
      const check = await checkAgency(a, fy);
      await db.prepare(`
        INSERT INTO reconciliation_check
          (run_id, check_date, dimension_type, dimension_value, fiscal_year,
           warehouse_total, warehouse_count, source_total, source_count,
           drift_abs, drift_pct, status, notes, created_at)
        VALUES (?, ?, 'agency', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).bind(
        runId, now, a.canonical_name, fy,
        a.total_value, a.num_awards,
        check.sourceTotal, check.sourceCount,
        check.driftAbs, check.driftPct,
        check.status, check.notes,
        now,
      ).run();
      if (check.status === 'drift') driftCount++;
    } catch (e) {
      errors++;
      const reason = e instanceof Error ? e.message : String(e);
      await db.prepare(`
        INSERT INTO reconciliation_check
          (run_id, check_date, dimension_type, dimension_value, fiscal_year,
           warehouse_total, warehouse_count, status, notes, created_at)
        VALUES (?, ?, 'agency', ?, ?, ?, ?, 'error', ?, ?)
      `).bind(
        runId, now, a.canonical_name, fy, a.total_value, a.num_awards, reason, now,
      ).run();
    }
  }

  const checksRun = agencies.results.length;

  await db.prepare(`
    UPDATE ingestion_run
    SET finished_at = ?, status = ?, rows_fetched = ?, rows_upserted = ?
    WHERE run_id = ?
  `).bind(
    now,
    errors > 0 ? (checksRun > errors ? 'partial' : 'failed') : 'success',
    checksRun, checksRun - errors, runId,
  ).run();

  await meta.put('LAST_RECONCILE', JSON.stringify({
    at: now, checksRun, driftCount, errors, fiscalYear: fy, toptierBackfilled,
  }));

  return { checksRun, driftCount, errors, toptierBackfilled };
}

interface CheckResult {
  sourceTotal: number | null;
  sourceCount: number | null;
  driftAbs: number | null;
  driftPct: number | null;
  status: 'ok' | 'drift' | 'no_data';
  notes: string | null;
}

async function checkAgency(a: AgencyWarehouseRow, fy: number): Promise<CheckResult> {
  if (!a.toptier_code) {
    return {
      sourceTotal: null, sourceCount: null, driftAbs: null, driftPct: null,
      status: 'no_data', notes: 'no toptier_code in organization.external_ids_json',
    };
  }

  const url = `${USASPENDING_BASE}/agency/${a.toptier_code}/obligations_by_award_category/?fiscal_year=${fy}`;
  const res = await fetch(url, { headers: { 'Accept': 'application/json' } });
  if (!res.ok) throw new Error(`USAspending ${res.status} for ${a.toptier_code}`);
  const data = await res.json() as {
    results?: Array<{ category: string; aggregated_amount: number; award_count?: number }>;
  };

  const contractTotal = (data.results ?? [])
    .filter((r) => /contracts?/i.test(r.category))
    .reduce((s, r) => s + (r.aggregated_amount ?? 0), 0);
  const contractCount = (data.results ?? [])
    .filter((r) => /contracts?/i.test(r.category))
    .reduce((s, r) => s + (r.award_count ?? 0), 0);

  if (!contractTotal) {
    return {
      sourceTotal: 0, sourceCount: 0, driftAbs: null, driftPct: null,
      status: 'no_data', notes: `no FY${fy} contract rollup returned`,
    };
  }

  const driftAbs = contractTotal - a.total_value;
  const driftPct = Math.abs(driftAbs) / contractTotal;
  const status: 'ok' | 'drift' = driftPct > 0.05 ? 'drift' : 'ok';
  return {
    sourceTotal: contractTotal,
    sourceCount: contractCount,
    driftAbs,
    driftPct,
    status,
    notes: status === 'drift'
      ? `FY${fy} drift ${(driftPct * 100).toFixed(1)}% — warehouse may be lagging or filtered`
      : null,
  };
}

function fiscalYearFor(d: Date): number {
  // US federal FY runs Oct 1 → Sep 30, labeled by calendar year of the end
  const month = d.getUTCMonth(); // 0-indexed
  const y = d.getUTCFullYear();
  return month >= 9 ? y + 1 : y;
}
