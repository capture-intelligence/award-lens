import { unzipSync, strFromU8 } from 'fflate';
import { parseCsv } from '../utils/csv.js';
import { sha256Hex } from '../utils/hash.js';
import { nowIso } from '../utils/ids.js';
import type { SamExclusionRow } from '../models/sam-exclusion.js';

/**
 * SAM.gov public data extracts — no API key required.
 *
 * Known endpoints (verify current URL at https://sam.gov/data-services):
 *   - Exclusions Public Extract:    ~10 MB/day
 *   - Entity Management Delta:      ~50 MB/day (changed entities only)
 *   - Entity Management Full:       ~500 MB/day — too large for a single
 *                                   Worker invocation; use delta instead.
 *
 * This adapter focuses on exclusions (small, high-value). Entity delta is
 * stubbed as a follow-on; see README for how to add it.
 */

export interface SamExtractDescriptor {
  id: 'exclusions' | 'entity_delta';
  url: string;
  innerCsvName?: string;  // CSV filename inside the ZIP (regex fallback if omitted)
}

export const SAM_EXTRACTS: Record<string, SamExtractDescriptor> = {
  exclusions: {
    id: 'exclusions',
    // Public download — no auth. If this URL returns HTML (login redirect),
    // check https://sam.gov/data-services for the current pattern.
    url: 'https://sam.gov/api/prod/fileextractservices/v1/api/download/Exclusions?type=CP',
  },
  entity_delta: {
    id: 'entity_delta',
    url: 'https://sam.gov/api/prod/fileextractservices/v1/api/download/EntityInformation?type=DELTA',
  },
};

export interface FetchedExtract {
  descriptor: SamExtractDescriptor;
  zipBytes: Uint8Array;
  responseHash: string;
  fetchedAt: string;
}

export async function fetchSamExtract(
  descriptor: SamExtractDescriptor,
  fetchImpl: typeof fetch = fetch,
): Promise<FetchedExtract> {
  const res = await fetchImpl(descriptor.url, {
    redirect: 'follow',
    headers: { 'User-Agent': 'awards-pipeline/0.1 (+github.com/your-repo)' },
  });
  if (!res.ok) throw new Error(`SAM ${descriptor.id} ${res.status}`);

  const contentType = res.headers.get('content-type') ?? '';
  if (contentType.includes('text/html')) {
    throw new Error(`SAM ${descriptor.id}: got HTML — URL pattern may have changed`);
  }

  const zipBytes = new Uint8Array(await res.arrayBuffer());
  if (zipBytes.length < 100) throw new Error(`SAM ${descriptor.id}: response too small (${zipBytes.length}B)`);

  return {
    descriptor,
    zipBytes,
    responseHash: await sha256Hex(zipBytes.buffer),
    fetchedAt: nowIso(),
  };
}

/**
 * Unzip the extract and yield parsed CSV rows keyed by header name.
 * fflate operates synchronously on an in-memory buffer — fine for the
 * exclusions extract (~10 MB). For the larger entity extract, prefer
 * the delta variant.
 */
export function* iterateExtractRows(
  zipBytes: Uint8Array,
  innerCsvPattern?: RegExp,
): Generator<Record<string, string>> {
  const entries = unzipSync(zipBytes);
  const match = Object.entries(entries).find(
    ([name]) => innerCsvPattern
      ? innerCsvPattern.test(name)
      : /\.csv$/i.test(name),
  );
  if (!match) throw new Error('No CSV found in SAM extract ZIP');

  const text = strFromU8(match[1]);
  const iter = parseCsv(text);
  const first = iter.next();
  if (first.done) return;
  const headers = first.value;

  for (const row of iter) {
    if (row.length === 1 && row[0] === '') continue;
    const obj: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) obj[headers[i]!] = row[i] ?? '';
    yield obj;
  }
}

/**
 * Map a parsed exclusion CSV row to a DB-ready shape.
 * Header names come from the SAM Public Exclusions extract.
 */
export function exclusionRowToDb(
  row: SamExclusionRow,
  extractDate: string,
): {
  exclusion_id: string;
  source_row_id: string | null;
  uei: string | null;
  duns: string | null;
  cage_code: string | null;
  legal_name: string;
  classification: string | null;
  exclusion_type: string | null;
  ct_code: string | null;
  is_active: number;
  active_date: string | null;
  termination_date: string | null;
  excluding_agency: string | null;
  reason: string | null;
  country_code: string | null;
  state: string | null;
  city: string | null;
  address_line: string | null;
  zip: string | null;
  extract_date: string;
} {
  const active = (row['Record Status'] ?? 'Active').toLowerCase() === 'active' ? 1 : 0;
  const uei = row['UEI']?.trim() || null;
  const name = row['Name']?.trim() || '(unknown)';
  const activeDate = parseSamDate(row['Active Date']);
  const ctCode = row['CT Code']?.trim() || null;

  // Source ID preference: SAM's own id → UEI+date+ct → name+date hash
  const srcId =
    row['Exclusion Id']?.trim() ||
    [uei ?? name, activeDate ?? '', ctCode ?? ''].join('::');

  return {
    exclusion_id: srcId,
    source_row_id: row['Exclusion Id']?.trim() || null,
    uei,
    duns: row['DUNS']?.trim() || null,
    cage_code: row['CAGE']?.trim() || null,
    legal_name: name,
    classification: row['Classification']?.trim() || null,
    exclusion_type: row['Exclusion Type']?.trim() || null,
    ct_code: ctCode,
    is_active: active,
    active_date: activeDate,
    termination_date: parseSamDate(row['Termination Date']),
    excluding_agency: row['Excluding Agency']?.trim() || null,
    reason: row['Additional Comments']?.trim() || null,
    country_code: row['Country']?.trim() || null,
    state: row['State / Province']?.trim() || null,
    city: row['City']?.trim() || null,
    address_line: [row['Address 1'], row['Address 2']]
      .filter(Boolean).join(', ').trim() || null,
    zip: row['Zip Code']?.trim() || null,
    extract_date: extractDate,
  };
}

function parseSamDate(s?: string): string | null {
  if (!s) return null;
  const trimmed = s.trim();
  if (!trimmed || trimmed.toLowerCase() === 'indefinite') return null;
  // SAM writes M/D/YYYY — normalize to YYYY-MM-DD
  const m = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/.exec(trimmed);
  if (m) {
    const [, mo, d, y] = m;
    return `${y}-${mo!.padStart(2, '0')}-${d!.padStart(2, '0')}`;
  }
  // Already ISO or unparseable — return as-is (schema will tolerate)
  return trimmed;
}
