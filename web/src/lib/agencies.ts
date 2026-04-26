/**
 * Federal agency reference data — toptier + selected subtier hierarchies.
 *
 * USAspending's `/search/spending_by_award/` endpoint accepts agency NAMES in
 * its filter block, not codes. Names are what we send to the API and store
 * in `data_view.filters_json`. Codes are kept for display only.
 *
 * Subtier coverage focuses on agencies most likely to come up — HHS,
 * DOD, DOJ, DHS, etc. Operators can fall back to free-text Keywords for
 * anything not listed.
 */

export interface Toptier {
  name: string;          // canonical USAspending name (what the API wants)
  abbrev: string;        // e.g. "HHS"
  code?: string;         // CGAC toptier code, display only
}

export interface Subtier {
  toptier_name: string;  // FK to Toptier.name
  name: string;          // canonical USAspending subtier name
  abbrev: string;        // e.g. "CDC"
  code?: string;         // subtier code, display only
}

export const TOPTIERS: Toptier[] = [
  { name: 'Department of Agriculture',                    abbrev: 'USDA',  code: '012' },
  { name: 'Department of Commerce',                       abbrev: 'DOC',   code: '013' },
  { name: 'Department of Defense',                        abbrev: 'DOD',   code: '097' },
  { name: 'Department of the Air Force',                  abbrev: 'AF',    code: '057' },
  { name: 'Department of the Army',                       abbrev: 'Army',  code: '021' },
  { name: 'Department of the Navy',                       abbrev: 'Navy',  code: '017' },
  { name: 'Department of Education',                      abbrev: 'ED',    code: '091' },
  { name: 'Department of Energy',                         abbrev: 'DOE',   code: '089' },
  { name: 'Department of Health and Human Services',      abbrev: 'HHS',   code: '075' },
  { name: 'Department of Homeland Security',              abbrev: 'DHS',   code: '070' },
  { name: 'Department of Housing and Urban Development',  abbrev: 'HUD',   code: '086' },
  { name: 'Department of the Interior',                   abbrev: 'DOI',   code: '014' },
  { name: 'Department of Justice',                        abbrev: 'DOJ',   code: '015' },
  { name: 'Department of Labor',                          abbrev: 'DOL',   code: '016' },
  { name: 'Department of State',                          abbrev: 'DOS',   code: '019' },
  { name: 'Department of Transportation',                 abbrev: 'DOT',   code: '069' },
  { name: 'Department of the Treasury',                   abbrev: 'TREAS', code: '020' },
  { name: 'Department of Veterans Affairs',               abbrev: 'VA',    code: '036' },
  { name: 'Environmental Protection Agency',              abbrev: 'EPA',   code: '068' },
  { name: 'General Services Administration',              abbrev: 'GSA',   code: '047' },
  { name: 'National Aeronautics and Space Administration',abbrev: 'NASA',  code: '080' },
  { name: 'National Science Foundation',                  abbrev: 'NSF',   code: '049' },
  { name: 'Nuclear Regulatory Commission',                abbrev: 'NRC',   code: '031' },
  { name: 'Office of Personnel Management',               abbrev: 'OPM',   code: '024' },
  { name: 'Small Business Administration',                abbrev: 'SBA',   code: '073' },
  { name: 'Social Security Administration',               abbrev: 'SSA',   code: '028' },
  { name: 'United States Agency for International Development', abbrev: 'USAID', code: '072' },
];

export const SUBTIERS: Subtier[] = [
  // ─── Department of Health and Human Services ──────────────────────────────
  { toptier_name: 'Department of Health and Human Services',
    name: 'Centers for Disease Control and Prevention', abbrev: 'CDC' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'National Institutes of Health', abbrev: 'NIH' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Food and Drug Administration', abbrev: 'FDA' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Centers for Medicare and Medicaid Services', abbrev: 'CMS' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Health Resources and Services Administration', abbrev: 'HRSA' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Indian Health Service', abbrev: 'IHS' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Substance Abuse and Mental Health Services Administration', abbrev: 'SAMHSA' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Agency for Healthcare Research and Quality', abbrev: 'AHRQ' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Administration for Children and Families', abbrev: 'ACF' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Administration for Community Living', abbrev: 'ACL' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Office of the Secretary', abbrev: 'OS' },
  { toptier_name: 'Department of Health and Human Services',
    name: 'Office of the Assistant Secretary for Preparedness and Response', abbrev: 'ASPR' },

  // ─── Department of Defense ────────────────────────────────────────────────
  { toptier_name: 'Department of Defense',
    name: 'Defense Health Agency', abbrev: 'DHA' },
  { toptier_name: 'Department of Defense',
    name: 'Defense Logistics Agency', abbrev: 'DLA' },
  { toptier_name: 'Department of Defense',
    name: 'Defense Information Systems Agency', abbrev: 'DISA' },
  { toptier_name: 'Department of Defense',
    name: 'Missile Defense Agency', abbrev: 'MDA' },
  { toptier_name: 'Department of Defense',
    name: 'Defense Advanced Research Projects Agency', abbrev: 'DARPA' },

  // ─── Department of Homeland Security ──────────────────────────────────────
  { toptier_name: 'Department of Homeland Security',
    name: 'Cybersecurity and Infrastructure Security Agency', abbrev: 'CISA' },
  { toptier_name: 'Department of Homeland Security',
    name: 'Federal Emergency Management Agency', abbrev: 'FEMA' },
  { toptier_name: 'Department of Homeland Security',
    name: 'U.S. Customs and Border Protection', abbrev: 'CBP' },
  { toptier_name: 'Department of Homeland Security',
    name: 'U.S. Immigration and Customs Enforcement', abbrev: 'ICE' },
  { toptier_name: 'Department of Homeland Security',
    name: 'Transportation Security Administration', abbrev: 'TSA' },
  { toptier_name: 'Department of Homeland Security',
    name: 'United States Coast Guard', abbrev: 'USCG' },

  // ─── Department of Justice ────────────────────────────────────────────────
  { toptier_name: 'Department of Justice',
    name: 'Federal Bureau of Investigation', abbrev: 'FBI' },
  { toptier_name: 'Department of Justice',
    name: 'Drug Enforcement Administration', abbrev: 'DEA' },
  { toptier_name: 'Department of Justice',
    name: 'Bureau of Alcohol, Tobacco, Firearms and Explosives', abbrev: 'ATF' },
  { toptier_name: 'Department of Justice',
    name: 'United States Marshals Service', abbrev: 'USMS' },
  { toptier_name: 'Department of Justice',
    name: 'Federal Bureau of Prisons', abbrev: 'BOP' },

  // ─── Department of Energy ─────────────────────────────────────────────────
  { toptier_name: 'Department of Energy',
    name: 'National Nuclear Security Administration', abbrev: 'NNSA' },

  // ─── Department of the Interior ───────────────────────────────────────────
  { toptier_name: 'Department of the Interior',
    name: 'National Park Service', abbrev: 'NPS' },
  { toptier_name: 'Department of the Interior',
    name: 'U.S. Geological Survey', abbrev: 'USGS' },
  { toptier_name: 'Department of the Interior',
    name: 'Bureau of Land Management', abbrev: 'BLM' },
  { toptier_name: 'Department of the Interior',
    name: 'U.S. Fish and Wildlife Service', abbrev: 'FWS' },
  { toptier_name: 'Department of the Interior',
    name: 'Bureau of Indian Affairs', abbrev: 'BIA' },

  // ─── Department of Commerce ───────────────────────────────────────────────
  { toptier_name: 'Department of Commerce',
    name: 'National Oceanic and Atmospheric Administration', abbrev: 'NOAA' },
  { toptier_name: 'Department of Commerce',
    name: 'National Institute of Standards and Technology', abbrev: 'NIST' },
  { toptier_name: 'Department of Commerce',
    name: 'United States Census Bureau', abbrev: 'Census' },
  { toptier_name: 'Department of Commerce',
    name: 'United States Patent and Trademark Office', abbrev: 'USPTO' },

  // ─── Department of Transportation ─────────────────────────────────────────
  { toptier_name: 'Department of Transportation',
    name: 'Federal Aviation Administration', abbrev: 'FAA' },
  { toptier_name: 'Department of Transportation',
    name: 'Federal Highway Administration', abbrev: 'FHWA' },
  { toptier_name: 'Department of Transportation',
    name: 'Federal Transit Administration', abbrev: 'FTA' },
  { toptier_name: 'Department of Transportation',
    name: 'Federal Railroad Administration', abbrev: 'FRA' },

  // ─── Department of the Treasury ──────────────────────────────────────────
  { toptier_name: 'Department of the Treasury',
    name: 'Internal Revenue Service', abbrev: 'IRS' },

  // ─── Department of Agriculture ───────────────────────────────────────────
  { toptier_name: 'Department of Agriculture',
    name: 'Animal and Plant Health Inspection Service', abbrev: 'APHIS' },
  { toptier_name: 'Department of Agriculture',
    name: 'Food Safety and Inspection Service', abbrev: 'FSIS' },
  { toptier_name: 'Department of Agriculture',
    name: 'United States Forest Service', abbrev: 'USFS' },
  { toptier_name: 'Department of Agriculture',
    name: 'Agricultural Research Service', abbrev: 'ARS' },
];

export function subtiersFor(toptierName: string | undefined): Subtier[] {
  if (!toptierName) return [];
  return SUBTIERS.filter((s) => s.toptier_name === toptierName);
}
