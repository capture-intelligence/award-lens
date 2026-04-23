import {
  GrantsGovSearchResponseSchema,
  GrantsGovOpportunityDetailSchema,
  type GrantsGovSearchHit,
  type GrantsGovOpportunityDetail,
} from '../models/grant.js';
import { sha256Hex } from '../utils/hash.js';
import { nowIso } from '../utils/ids.js';

const BASE = 'https://api.grants.gov/v1/api';

export interface GrantsGovSearchOptions {
  keyword?: string;
  statuses?: Array<'posted' | 'forecasted' | 'closed' | 'archived'>;
  agencies?: string[];       // agency codes e.g., 'HHS-CDC'
  cfda?: string[];           // e.g., ['93.067']
  eligibilities?: string[];
  rows?: number;             // page size (max 1000)
  startRecordNum?: number;
}

export async function searchGrantsGov(
  opts: GrantsGovSearchOptions = {},
  fetchImpl: typeof fetch = fetch,
): Promise<{
  hits: GrantsGovSearchHit[];
  hitCount: number;
  raw: { request: unknown; response: unknown; responseHash: string; fetchedAt: string };
}> {
  const body = {
    keyword: opts.keyword ?? '',
    oppStatuses: (opts.statuses ?? ['posted', 'forecasted']).join('|'),
    rows: opts.rows ?? 1000,
    startRecordNum: opts.startRecordNum ?? 0,
    eligibilities: (opts.eligibilities ?? []).join('|'),
    agencies: (opts.agencies ?? []).join('|'),
    aln: (opts.cfda ?? []).join('|'),
    fundingCategories: '',
    sortBy: 'openDate|desc',
  };

  const res = await fetchImpl(`${BASE}/search2`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`Grants.gov search ${res.status}`);
  const text = await res.text();
  const parsed = GrantsGovSearchResponseSchema.parse(JSON.parse(text));
  if (parsed.errorcode !== 0) {
    throw new Error(`Grants.gov error ${parsed.errorcode}: ${parsed.msg}`);
  }

  return {
    hits: parsed.data.oppHits,
    hitCount: parsed.data.hitCount,
    raw: {
      request: body,
      response: parsed,
      responseHash: await sha256Hex(text),
      fetchedAt: nowIso(),
    },
  };
}

export async function fetchGrantsGovOpportunity(
  oppId: string | number,
  fetchImpl: typeof fetch = fetch,
): Promise<GrantsGovOpportunityDetail> {
  const res = await fetchImpl(`${BASE}/fetchOpportunity`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
    body: JSON.stringify({ opportunityId: String(oppId) }),
  });
  if (!res.ok) throw new Error(`Grants.gov fetchOpportunity ${res.status}`);
  const json = await res.json();
  // Grants.gov wraps detail in `data`
  const payload = (json as { data?: unknown }).data ?? json;
  return GrantsGovOpportunityDetailSchema.parse(payload);
}

/**
 * Map a search hit (plus optional detail) to the grant_opportunity DB row.
 */
export function hitToDbRow(
  hit: GrantsGovSearchHit,
  detail: GrantsGovOpportunityDetail | null,
  extractDate: string,
): {
  opportunity_id: string;
  opportunity_number: string | null;
  title: string;
  agency_code: string | null;
  agency_name: string | null;
  category: string | null;
  funding_instrument: string | null;
  assistance_listings: string | null;
  posted_date: string | null;
  close_date: string | null;
  archive_date: string | null;
  est_total_funding: number | null;
  award_ceiling: number | null;
  award_floor: number | null;
  expected_awards: number | null;
  eligibility_codes: string | null;
  description: string | null;
  status: string | null;
  opportunity_url: string;
  doc_type: string | null;
  extract_date: string;
} {
  const id = String(hit.id);
  const cfdas = detail?.cfdas?.map((c) => c.cfdaNumber).join(',')
             ?? hit.alnist?.join(',')
             ?? null;
  const syn = detail?.synopsis;

  return {
    opportunity_id: id,
    opportunity_number: hit.number ?? detail?.opportunityNumber ?? null,
    title: hit.title ?? detail?.opportunityTitle ?? '(untitled)',
    agency_code: hit.agencyCode ?? detail?.owningAgencyCode ?? null,
    agency_name: hit.agencyName ?? detail?.agencyName ?? null,
    category: detail?.category ?? null,
    funding_instrument: detail?.fundingInstruments?.map((f) => f.description).join(',') ?? null,
    assistance_listings: cfdas,
    posted_date: normalizeDate(syn?.postingDate ?? hit.openDate ?? null),
    close_date: normalizeDate(syn?.responseDate ?? hit.closeDate ?? null),
    archive_date: normalizeDate(syn?.archiveDate ?? null),
    est_total_funding: toNumber(syn?.estimatedFunding),
    award_ceiling: toNumber(syn?.awardCeiling),
    award_floor: toNumber(syn?.awardFloor),
    expected_awards: toInt(syn?.expectedNumberOfAwards),
    eligibility_codes: detail?.eligibilityList?.map((e) => e.code).join(',') ?? null,
    description: syn?.synopsisDesc ?? null,
    status: (hit.oppStatus ?? '').toLowerCase() || null,
    opportunity_url: `https://grants.gov/search-results-detail/${id}`,
    doc_type: hit.docType ?? null,
    extract_date: extractDate,
  };
}

function normalizeDate(s?: string | null): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed) return null;
  // Grants.gov emits MM/DD/YYYY most commonly
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  return trimmed;
}

function toNumber(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function toInt(v: unknown): number | null {
  const n = toNumber(v);
  return n === null ? null : Math.trunc(n);
}
