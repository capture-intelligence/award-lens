import { nowIso } from '@awards/core';

/**
 * SAM.gov Entity Management API (v4) — public tier.
 * See: https://open.gsa.gov/api/entity-api/
 */
const SAM_BASE = 'https://api.sam.gov/entity-information/v4';

export interface SamEntityResponse {
  totalRecords?: number;
  entityData?: SamEntity[];
}

export interface SamEntity {
  entityRegistration?: {
    samRegistered?: string;
    ueiSAM?: string;
    entityEFTIndicator?: string | null;
    cageCode?: string;
    dodaac?: string | null;
    legalBusinessName?: string;
    dbaName?: string | null;
    purposeOfRegistrationCode?: string;
    registrationStatus?: string;       // 'Active' | 'Inactive' | 'Expired'
    evsSource?: string;
    registrationDate?: string;
    lastUpdateDate?: string;
    registrationExpirationDate?: string;
    activationDate?: string;
    ueiStatus?: string;
    ueiExpirationDate?: string;
    ueiCreationDate?: string;
    publicDisplayFlag?: string;
    exclusionStatusFlag?: string;
    exclusionURL?: string | null;
    dnbOpenData?: string | null;
  };
  coreData?: {
    entityInformation?: {
      entityURL?: string | null;
      entityDivisionName?: string | null;
      entityDivisionNumber?: string | null;
      entityStartDate?: string;
      fiscalYearEndCloseDate?: string;
    };
    physicalAddress?: {
      addressLine1?: string;
      addressLine2?: string | null;
      city?: string;
      stateOrProvinceCode?: string;
      zipCode?: string;
      zipCodePlus4?: string;
      countryCode?: string;
    };
    businessTypes?: {
      businessTypeList?: Array<{ businessTypeCode: string; businessTypeDesc: string }>;
    };
  };
}

export async function lookupEntityByUei(
  uei: string,
  apiKey: string,
): Promise<SamEntity | null> {
  const url = new URL(`${SAM_BASE}/entities`);
  url.searchParams.set('ueiSAM', uei);
  url.searchParams.set('api_key', apiKey);
  url.searchParams.set('includeSections', 'entityRegistration,coreData');

  const res = await fetch(url.toString(), { headers: { 'Accept': 'application/json' } });
  if (res.status === 404) return null;
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`SAM entity ${res.status}: ${text.slice(0, 300)}`);
  }
  const data = await res.json() as SamEntityResponse;
  return data.entityData?.[0] ?? null;
}

/**
 * Apply a SAM entity response to the warehouse:
 *  - update vendor row (UEI-keyed) with canonical address/name/cage
 *  - emit vendor_classification rows for each businessTypeCode
 */
export async function applySamEntityToWarehouse(
  db: D1Database,
  uei: string,
  entity: SamEntity,
): Promise<{ vendorsUpdated: number; classificationsAdded: number }> {
  const now = nowIso();
  const reg = entity.entityRegistration;
  const addr = entity.coreData?.physicalAddress;

  const stmts: D1PreparedStatement[] = [];

  stmts.push(db.prepare(`
    UPDATE vendor
    SET legal_name    = COALESCE(?, legal_name),
        cage_code     = COALESCE(?, cage_code),
        city          = COALESCE(?, city),
        state         = COALESCE(?, state),
        zip           = COALESCE(?, zip),
        country_code  = COALESCE(?, country_code),
        is_stub       = 0,
        updated_at    = ?
    WHERE uei = ?
  `).bind(
    reg?.legalBusinessName ?? null,
    reg?.cageCode ?? null,
    addr?.city ?? null,
    addr?.stateOrProvinceCode ?? null,
    addr?.zipCode ?? null,
    addr?.countryCode ?? null,
    now,
    uei,
  ));

  const types = entity.coreData?.businessTypes?.businessTypeList ?? [];
  for (const bt of types) {
    stmts.push(db.prepare(`
      INSERT OR IGNORE INTO vendor_classification
        (vendor_id, classification, effective_from, source_id)
      SELECT vendor_id, ?, ?, 'sam_api'
      FROM vendor WHERE uei = ?
    `).bind(`${bt.businessTypeCode}:${bt.businessTypeDesc}`, now.slice(0, 10), uei));
  }

  // Registration status as a classification tag (so it surfaces in the dashboard)
  if (reg?.registrationStatus) {
    stmts.push(db.prepare(`
      INSERT OR IGNORE INTO vendor_classification
        (vendor_id, classification, effective_from, source_id)
      SELECT vendor_id, ?, ?, 'sam_api'
      FROM vendor WHERE uei = ?
    `).bind(`sam_registration:${reg.registrationStatus}`, now.slice(0, 10), uei));
  }

  const results = await db.batch(stmts);
  const vendorsUpdated = results[0]?.meta.changes ?? 0;
  return {
    vendorsUpdated,
    classificationsAdded: types.length + (reg?.registrationStatus ? 1 : 0),
  };
}
