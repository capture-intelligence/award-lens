/**
 * Canonical DTOs — source-agnostic representations that every adapter maps to.
 * Writes into the warehouse go through these shapes.
 */

export interface CanonicalOrganization {
  external_id: string;           // source-specific id (e.g., fpds agency code)
  canonical_name: string;
  short_name?: string;
  acronym?: string;
  org_type: string;              // 'department','agency','bureau','office',...
  parent_external_id?: string;
  country_code?: string;
  external_ids_json?: Record<string, string>;
}

export interface CanonicalVendor {
  external_id: string;           // source's recipient id or UEI
  uei?: string;
  duns?: string;
  cage_code?: string;
  legal_name: string;
  common_name?: string;
  country_code?: string;
  state?: string;
  city?: string;
  zip?: string;
  primary_naics?: string;
  business_categories?: string[]; // small_business, woman_owned, 8a, etc.
}

export interface CanonicalAward {
  external_id: string;           // generated_unique_award_id (USAspending)
  award_piid?: string;
  parent_piid?: string;
  award_type?: string;           // 'definitive','delivery_order','bpa_call','grant'
  description?: string;
  base_value?: number;
  current_value?: number;
  obligated_amount?: number;
  currency_code?: string;        // default USD
  pop_start_date?: string;       // ISO date
  pop_end_date?: string;
  solicitation_id?: string;
  source_last_modified: string;  // ISO datetime — drives upsert decision

  vendor: CanonicalVendor;
  awarding_org?: CanonicalOrganization;
  funding_org?: CanonicalOrganization;

  naics_code?: string;
  naics_description?: string;
  psc_code?: string;
  psc_description?: string;

  performance_location?: {
    country_code?: string;
    state?: string;
    city?: string;
    zip?: string;
    congressional_district?: string;
  };
}
