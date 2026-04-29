/**
 * Federal account → CDC center mapping.
 *
 * CDC's appropriations are split across discrete federal accounts at the
 * Treasury level. Each NATIONAL CENTER (NCHHSTP, NCEZID, etc.) has its own
 * line, so the federal_account_code is the authoritative center identifier.
 * A few accounts are cross-cutting (CDC-Wide) or program-specific (WTC); we
 * label those explicitly so they don't end up in "Unknown".
 *
 * Source: CDC's annual Justification of Estimates (FY24/FY25/FY26 budgets).
 *
 * Multi-account contracts are tagged by their FIRST federal account in
 * /explore (i.e., the primary funding line). Subsequent accounts are still
 * accessible via federal_account_codes for cases that need them.
 */

export interface CdcCenter {
  code: string;
  name: string;
}

const MAP: Record<string, CdcCenter> = {
  '075-0140': { code: 'PHSSEF',  name: 'Public Health and Social Services Emergency Fund (HHS)' },
  '075-0512': { code: 'CMS',     name: 'Grants to States for Medicaid (CMS, inter-agency)' },
  '075-0943': { code: 'CDC-WIDE', name: 'CDC-Wide Activities and Program Support' },
  '075-0944': { code: 'ATSDR',   name: 'Toxic Substances and Environmental Public Health (ATSDR)' },
  '075-0945': { code: 'IDRRRF',  name: 'Infectious Diseases Rapid Response Reserve Fund' },
  '075-0946': { code: 'WTCHP',   name: 'World Trade Center Health Program' },
  '075-0947': { code: 'NCEH',    name: 'National Center for Environmental Health' },
  '075-0948': { code: 'NCCDPHP', name: 'National Center for Chronic Disease Prevention and Health Promotion' },
  '075-0949': { code: 'NCEZID',  name: 'National Center for Emerging and Zoonotic Infectious Diseases' },
  '075-0950': { code: 'NCHHSTP', name: 'National Center for HIV, Viral Hepatitis, STD, and TB Prevention' },
  '075-0951': { code: 'NCIRD',   name: 'National Center for Immunization and Respiratory Diseases' },
  '075-0952': { code: 'NCIPC',   name: 'National Center for Injury Prevention and Control' },
  '075-0953': { code: 'NCBDDD',  name: 'National Center on Birth Defects and Developmental Disabilities' },
  '075-0954': { code: 'NIOSH',   name: 'National Institute for Occupational Safety and Health' },
  '075-0955': { code: 'CGH',     name: 'Center for Global Health' },
  '075-0956': { code: 'OPHPR',   name: 'Public Health Preparedness and Response' },
  '075-0958': { code: 'OPHDST',  name: 'Office of Public Health Data, Surveillance, and Technology' },
  '075-0959': { code: 'PHSS',    name: 'Public Health Scientific Services (NCHS / CSELS)' },
  '075-4553': { code: 'WCF',     name: 'CDC Working Capital Fund' },
};

const UNKNOWN: CdcCenter = { code: 'UNKNOWN', name: '(no federal account on record)' };

/** Map a federal_account_code (e.g., "075-0950") to its CDC center. */
export function lookupCenter(federalAccountCode: string | null | undefined): CdcCenter {
  if (!federalAccountCode) return UNKNOWN;
  const hit = MAP[federalAccountCode];
  if (hit) return hit;
  // Unknown account — surface the raw code so the field isn't blank.
  return { code: 'OTHER', name: `Other federal account (${federalAccountCode})` };
}

/**
 * Pick the primary federal account from a `|`-joined GROUP_CONCAT string and
 * resolve to a center. First entry wins; this is a stable choice as long as
 * award_federal_account inserts preserve the order USAspending /awards/funding/
 * returns. For our purposes that's good enough — multi-account contracts can
 * still be inspected via federal_account_codes.
 */
export function resolveCenter(joinedAccountCodes: string | null | undefined): CdcCenter {
  if (!joinedAccountCodes) return UNKNOWN;
  const first = joinedAccountCodes.split('|')[0]?.trim();
  return lookupCenter(first || null);
}
