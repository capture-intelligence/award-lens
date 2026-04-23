import { BaseSourceAdapter, type FetchWindow, type RawRecord } from './base.js';
import {
  UsaspendingSearchResponseSchema,
  type UsaspendingAwardRow,
  type UsaspendingSearchResponse,
} from '../models/award.js';
import type { CanonicalAward } from '../models/canonical.js';
import { sha256Hex } from '../utils/hash.js';

const BASE_URL = 'https://api.usaspending.gov/api/v2';
const PAGE_SIZE = 100;

/**
 * Contract award type codes per USAspending.
 * A,B,C,D = procurement contracts. Add '02','03','04','05' for grants.
 */
const CONTRACT_AWARD_TYPES = ['A', 'B', 'C', 'D'];

/**
 * Narrowing filters applied on top of the required time_period + award_type.
 * Any combination reduces the result set dramatically — use them to keep
 * your ingestion focused and fast.
 */
export interface UsaspendingFilters {
  /** Toptier agency names — e.g., ["Department of Health and Human Services"] */
  agencies?: string[];
  /** Subtier agency names — e.g., ["Centers for Disease Control and Prevention"] */
  subtier_agencies?: string[];
  /** Keyword search across description/PIID — e.g., ["HIV","tuberculosis"] */
  keywords?: string[];
  /** NAICS codes — e.g., ["541511","541712"] */
  naics_codes?: string[];
  /** PSC codes — e.g., ["R408","Q301"] */
  psc_codes?: string[];
  /** Recipient name substring — e.g., "Lantana" */
  recipient_search_text?: string;
  /** Award types — defaults to contracts (A,B,C,D). Use ["02","03","04","05"] for grants. */
  award_type_codes?: string[];
  /** Minimum contract/award value (USD). Inclusive lower bound. */
  award_amount_min?: number;
  /** Maximum contract/award value (USD). Inclusive upper bound. */
  award_amount_max?: number;
}

export class UsaspendingAdapter extends BaseSourceAdapter {
  readonly sourceId = 'usaspending';

  constructor(private filters: UsaspendingFilters = {}) {
    super();
  }

  async fetchPage(
    window: FetchWindow,
    page: number,
  ): Promise<{ raw: RawRecord; hasMore: boolean; records: UsaspendingAwardRow[] }> {
    const filterBlock: Record<string, unknown> = {
      time_period: [{
        start_date: window.since.slice(0, 10),
        end_date:   window.until.slice(0, 10),
        date_type:  'action_date',
      }],
      award_type_codes: this.filters.award_type_codes ?? CONTRACT_AWARD_TYPES,
    };
    // USAspending expects `agencies` as an array of { type, tier, name } objects.
    const agencyObjs: Array<{ type: string; tier: string; name: string }> = [];
    for (const name of this.filters.agencies ?? []) {
      agencyObjs.push({ type: 'awarding', tier: 'toptier', name });
    }
    for (const name of this.filters.subtier_agencies ?? []) {
      agencyObjs.push({ type: 'awarding', tier: 'subtier', name });
    }
    if (agencyObjs.length) filterBlock.agencies = agencyObjs;
    if (this.filters.keywords?.length)     filterBlock.keywords = this.filters.keywords;
    if (this.filters.naics_codes?.length)  filterBlock.naics_codes = this.filters.naics_codes;
    if (this.filters.psc_codes?.length)    filterBlock.psc_codes = this.filters.psc_codes;
    if (this.filters.recipient_search_text) {
      filterBlock.recipient_search_text = [this.filters.recipient_search_text];
    }

    // Award amount range — USAspending expects an array of bound objects.
    // Pass either bound (or both) to scope by contract size.
    const { award_amount_min: lo, award_amount_max: hi } = this.filters;
    if (lo !== undefined || hi !== undefined) {
      const bound: Record<string, number> = {};
      if (lo !== undefined) bound.lower_bound = lo;
      if (hi !== undefined) bound.upper_bound = hi;
      filterBlock.award_amounts = [bound];
    }

    const payload = {
      filters: filterBlock,
      fields: [
        'Award ID',
        'Recipient Name',
        'Recipient UEI',
        'Award Amount',
        'Total Outlays',
        'Description',
        'Contract Award Type',
        'Start Date',
        'End Date',
        'Awarding Agency',
        'Awarding Sub Agency',
        'Funding Agency',
        'NAICS',
        'PSC',
        'Last Modified Date',
        'recipient_id',
        'Place of Performance State Code',
        'Place of Performance Country Code',
      ],
      sort: 'Last Modified Date',
      order: 'asc',
      limit: PAGE_SIZE,
      page,
    };

    const endpoint = '/search/spending_by_award/';
    // NOTE: Must call `fetch` directly, not a stored reference like
    // `this.fetchImpl`. Storing it as an instance field and invoking via
    // `this.fetchImpl(...)` strips the correct `this` binding in Workers
    // and throws "Illegal invocation".
    const res = await fetch(`${BASE_URL}${endpoint}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Accept': 'application/json' },
      body: JSON.stringify(payload),
    });

    if (!res.ok) {
      const text = await res.text();
      throw new Error(`USAspending ${res.status}: ${text.slice(0, 500)}`);
    }

    const text = await res.text();
    const data = UsaspendingSearchResponseSchema.parse(JSON.parse(text));

    const raw: RawRecord = {
      endpoint,
      requestParams: payload,
      response: data,
      responseHash: await sha256Hex(text),
    };

    return {
      raw,
      hasMore: data.page_metadata.hasNext,
      records: data.results,
    };
  }

  parse(raw: RawRecord): CanonicalAward[] {
    const data = raw.response as UsaspendingSearchResponse;
    return data.results
      .map((row) => this.rowToCanonical(row))
      .filter((r): r is CanonicalAward => r !== null);
  }

  private rowToCanonical(row: UsaspendingAwardRow): CanonicalAward | null {
    const external_id = row['generated_internal_id'];
    if (!external_id) return null;

    // USAspending sometimes returns these as plain strings, sometimes as
    // { code, description } objects (and newer responses wrap agency names
    // similarly). Extract the primitive value defensively.
    const asStr = (v: unknown): string | undefined => {
      if (v == null) return undefined;
      if (typeof v === 'string') return v;
      if (typeof v === 'object' && v && 'code' in v && typeof (v as { code: unknown }).code === 'string') {
        return (v as { code: string }).code;
      }
      if (typeof v === 'object' && v && 'name' in v && typeof (v as { name: unknown }).name === 'string') {
        return (v as { name: string }).name;
      }
      return undefined;
    };
    const asDesc = (v: unknown): string | undefined => {
      if (typeof v === 'object' && v && 'description' in v) {
        const d = (v as { description: unknown }).description;
        return typeof d === 'string' ? d : undefined;
      }
      return undefined;
    };

    const awardingAgency = asStr(row['Awarding Agency']);
    const awardingSub    = asStr(row['Awarding Sub Agency']);
    const fundingAgency  = asStr(row['Funding Agency']);
    const naicsCode      = asStr(row['NAICS']);
    const naicsDesc      = asDesc(row['NAICS']);
    const pscCode        = asStr(row['PSC']);
    const pscDesc        = asDesc(row['PSC']);

    return {
      external_id,
      award_piid:  row['Award ID'] ?? undefined,
      award_type:  row['Contract Award Type'] ?? undefined,
      description: row['Description'] ?? undefined,
      current_value:    row['Award Amount'] ?? undefined,
      obligated_amount: row['Total Outlays'] ?? undefined,
      pop_start_date:   row['Start Date'] ?? undefined,
      pop_end_date:     row['End Date'] ?? undefined,
      source_last_modified: row['Last Modified Date'] ?? new Date().toISOString(),
      currency_code: 'USD',
      naics_code: naicsCode,
      naics_description: naicsDesc,
      psc_code:   pscCode,
      psc_description: pscDesc,
      vendor: {
        external_id: row['recipient_id'] ?? row['Recipient UEI'] ?? row['Recipient Name'] ?? external_id,
        uei: row['Recipient UEI'] ?? undefined,
        legal_name: row['Recipient Name'] ?? '(unknown vendor)',
      },
      awarding_org: awardingAgency ? {
        external_id: awardingSub ? `${awardingAgency}::${awardingSub}` : awardingAgency,
        canonical_name: awardingSub ?? awardingAgency,
        short_name: awardingAgency,
        org_type: awardingSub ? 'bureau' : 'department',
      } : undefined,
      funding_org: fundingAgency ? {
        external_id: fundingAgency,
        canonical_name: fundingAgency,
        org_type: 'department',
      } : undefined,
      performance_location: (row['Place of Performance State Code'] || row['Place of Performance Country Code']) ? {
        country_code: row['Place of Performance Country Code'] ?? undefined,
        state:        row['Place of Performance State Code'] ?? undefined,
      } : undefined,
    };
  }
}
