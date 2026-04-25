import { nowIso, retry } from '@awards/core';
import { TOPTIER_AGENCIES } from './toptier-agencies.bundled.js';

/**
 * Backfills toptier_code + abbreviation onto existing `organization` rows
 * by calling USAspending's /references/toptier_agencies/. Needed so that
 * reconciliation can look up the source-side rollup per agency.
 *
 * Match strategy:
 *   1. Exact canonical_name match
 *   2. Case-insensitive match
 *   3. Match against `organization_alias` rows
 *   4. Skip silently (logged in response for manual review)
 */

const USASPENDING_BASE = 'https://api.usaspending.gov/api/v2';

interface ToptierAgency {
  toptier_code: string;
  agency_id: number;
  abbreviation: string | null;
  agency_name: string;
}

export interface BackfillResult {
  totalAgencies: number;
  matchedExact: number;
  matchedCaseInsensitive: number;
  matchedAlias: number;
  unmatched: string[];
  durationMs: number;
  source: 'live' | 'bundled';
  error?: string;
}

export async function backfillToptierCodes(db: D1Database): Promise<BackfillResult> {
  const t0 = Date.now();

  // Try live USAspending first; fall back to bundled snapshot if unreachable.
  // The toptier agency list rarely changes so the bundled copy is acceptable
  // for reconciliation purposes until the live endpoint recovers.
  let agencies: ToptierAgency[] = [];
  let source: 'live' | 'bundled' = 'live';
  let fallbackReason: string | undefined;
  try {
    const data = await retry(
      async () => {
        const res = await fetch(`${USASPENDING_BASE}/references/toptier_agencies/`, {
          headers: { 'Accept': 'application/json' },
          signal: AbortSignal.timeout(15_000),
        });
        if (!res.ok) throw new Error(`USAspending toptier agencies ${res.status}`);
        return (await res.json()) as { results: ToptierAgency[] };
      },
      { maxAttempts: 3, baseDelayMs: 1500, maxDelayMs: 8000 },
    );
    agencies = data.results ?? [];
  } catch (e) {
    fallbackReason = e instanceof Error ? e.message : String(e);
    agencies = TOPTIER_AGENCIES;
    source = 'bundled';
    console.warn(`[toptier-backfill] using bundled list (${fallbackReason})`);
  }

  const now = nowIso();

  // Pull everything we need for matching in ONE round trip.
  const [orgsQ, aliasesQ] = await db.batch([
    db.prepare(`
      SELECT org_id, canonical_name
      FROM organization
      WHERE parent_org_id IS NULL
    `),
    db.prepare(`
      SELECT org_id, alias FROM organization_alias
    `),
  ]);
  const orgs    = (orgsQ.results    ?? []) as Array<{ org_id: string; canonical_name: string }>;
  const aliases = (aliasesQ.results ?? []) as Array<{ org_id: string; alias: string }>;

  // In-memory lookup indexes
  const byExact = new Map<string, string>();
  const byLower = new Map<string, string>();
  for (const o of orgs) {
    byExact.set(o.canonical_name, o.org_id);
    byLower.set(o.canonical_name.toLowerCase(), o.org_id);
  }
  const byAliasLower = new Map<string, string>();
  for (const a of aliases) {
    byAliasLower.set(a.alias.toLowerCase(), a.org_id);
  }

  let matchedExact = 0;
  let matchedCaseInsensitive = 0;
  let matchedAlias = 0;
  const unmatched: string[] = [];
  const updates: D1PreparedStatement[] = [];

  for (const a of agencies) {
    const name = a.agency_name;
    const lower = name.toLowerCase();
    let orgId: string | undefined;

    if ((orgId = byExact.get(name))) {
      matchedExact++;
    } else if ((orgId = byLower.get(lower))) {
      matchedCaseInsensitive++;
    } else if ((orgId = byAliasLower.get(lower))) {
      matchedAlias++;
    } else {
      unmatched.push(name);
      continue;
    }

    const payload = JSON.stringify({
      toptier_code: a.toptier_code,
      abbreviation: a.abbreviation ?? undefined,
      usaspending_agency_id: String(a.agency_id),
    });
    updates.push(
      db.prepare(`
        UPDATE organization
        SET external_ids_json = ?, updated_at = ?
        WHERE org_id = ?
      `).bind(payload, now, orgId),
    );
  }

  // One atomic batch — dozens of updates become a single round trip.
  if (updates.length > 0) await db.batch(updates);

  return {
    totalAgencies: agencies.length,
    matchedExact,
    matchedCaseInsensitive,
    matchedAlias,
    unmatched: unmatched.slice(0, 50),
    durationMs: Date.now() - t0,
    source,
    ...(fallbackReason ? { error: `Live USAspending unreachable — used bundled snapshot. Details: ${fallbackReason}` } : {}),
  };
}

/**
 * Lightweight helper used by reconciliation to guard against running checks
 * when no toptier codes are populated yet.
 */
export async function countOrgsWithToptier(db: D1Database): Promise<number> {
  const row = await db.prepare(`
    SELECT COUNT(*) AS n
    FROM organization
    WHERE json_extract(external_ids_json, '$.toptier_code') IS NOT NULL
  `).first<{ n: number }>();
  return row?.n ?? 0;
}
