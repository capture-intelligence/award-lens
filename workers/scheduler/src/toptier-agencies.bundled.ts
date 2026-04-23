/**
 * Snapshot of USAspending's /references/toptier_agencies/ endpoint.
 * Used as a fallback when the live endpoint is unreachable from the
 * Cloudflare edge (intermittent 525 TLS handshake issues observed).
 *
 * Refresh roughly yearly by running:
 *   curl https://api.usaspending.gov/api/v2/references/toptier_agencies/ \
 *     | jq '.results' > bundled.json
 * and pasting the array here.
 */

export interface ToptierAgency {
  toptier_code: string;
  agency_id: number;
  abbreviation: string | null;
  agency_name: string;
}

export const TOPTIER_AGENCIES: ToptierAgency[] = [
  { toptier_code: '097', agency_id:  97, abbreviation: 'DOD',    agency_name: 'Department of Defense' },
  { toptier_code: '075', agency_id:  75, abbreviation: 'HHS',    agency_name: 'Department of Health and Human Services' },
  { toptier_code: '070', agency_id:  70, abbreviation: 'DHS',    agency_name: 'Department of Homeland Security' },
  { toptier_code: '012', agency_id:  12, abbreviation: 'USDA',   agency_name: 'Department of Agriculture' },
  { toptier_code: '013', agency_id:  13, abbreviation: 'DOC',    agency_name: 'Department of Commerce' },
  { toptier_code: '015', agency_id:  15, abbreviation: 'DOJ',    agency_name: 'Department of Justice' },
  { toptier_code: '019', agency_id:  19, abbreviation: 'DOS',    agency_name: 'Department of State' },
  { toptier_code: '020', agency_id:  20, abbreviation: 'TREAS',  agency_name: 'Department of the Treasury' },
  { toptier_code: '014', agency_id:  14, abbreviation: 'DOI',    agency_name: 'Department of the Interior' },
  { toptier_code: '069', agency_id:  69, abbreviation: 'DOT',    agency_name: 'Department of Transportation' },
  { toptier_code: '089', agency_id:  89, abbreviation: 'DOE',    agency_name: 'Department of Energy' },
  { toptier_code: '091', agency_id:  91, abbreviation: 'ED',     agency_name: 'Department of Education' },
  { toptier_code: '036', agency_id:  36, abbreviation: 'VA',     agency_name: 'Department of Veterans Affairs' },
  { toptier_code: '086', agency_id:  86, abbreviation: 'HUD',    agency_name: 'Department of Housing and Urban Development' },
  { toptier_code: '016', agency_id:  16, abbreviation: 'DOL',    agency_name: 'Department of Labor' },
  { toptier_code: '080', agency_id:  80, abbreviation: 'NASA',   agency_name: 'National Aeronautics and Space Administration' },
  { toptier_code: '049', agency_id:  49, abbreviation: 'NSF',    agency_name: 'National Science Foundation' },
  { toptier_code: '047', agency_id:  47, abbreviation: 'GSA',    agency_name: 'General Services Administration' },
  { toptier_code: '028', agency_id:  28, abbreviation: 'SSA',    agency_name: 'Social Security Administration' },
  { toptier_code: '024', agency_id:  24, abbreviation: 'OPM',    agency_name: 'Office of Personnel Management' },
  { toptier_code: '073', agency_id:  73, abbreviation: 'SBA',    agency_name: 'Small Business Administration' },
  { toptier_code: '068', agency_id:  68, abbreviation: 'EPA',    agency_name: 'Environmental Protection Agency' },
  { toptier_code: '072', agency_id:  72, abbreviation: 'USAID',  agency_name: 'Agency for International Development' },
  { toptier_code: '033', agency_id:  33, abbreviation: 'SI',     agency_name: 'Smithsonian Institution' },
  { toptier_code: '034', agency_id:  34, abbreviation: 'IAF',    agency_name: 'Inter-American Foundation' },
  { toptier_code: '095', agency_id:  95, abbreviation: 'EOP',    agency_name: 'Executive Office of the President' },
  { toptier_code: '005', agency_id:   5, abbreviation: 'GAO',    agency_name: 'Government Accountability Office' },
  { toptier_code: '007', agency_id:   7, abbreviation: 'FTC',    agency_name: 'Federal Trade Commission' },
  { toptier_code: '022', agency_id:  22, abbreviation: 'NARA',   agency_name: 'National Archives and Records Administration' },
  { toptier_code: '025', agency_id:  25, abbreviation: 'NRC',    agency_name: 'Nuclear Regulatory Commission' },
  { toptier_code: '026', agency_id:  26, abbreviation: 'OSC',    agency_name: 'Office of Special Counsel' },
  { toptier_code: '029', agency_id:  29, abbreviation: 'CFTC',   agency_name: 'Commodity Futures Trading Commission' },
  { toptier_code: '031', agency_id:  31, abbreviation: 'NLRB',   agency_name: 'National Labor Relations Board' },
  { toptier_code: '041', agency_id:  41, abbreviation: 'RRB',    agency_name: 'Railroad Retirement Board' },
  { toptier_code: '045', agency_id:  45, abbreviation: 'CPSC',   agency_name: 'Consumer Product Safety Commission' },
  { toptier_code: '046', agency_id:  46, abbreviation: 'EEOC',   agency_name: 'Equal Employment Opportunity Commission' },
  { toptier_code: '050', agency_id:  50, abbreviation: 'SEC',    agency_name: 'Securities and Exchange Commission' },
  { toptier_code: '051', agency_id:  51, abbreviation: 'FCC',    agency_name: 'Federal Communications Commission' },
  { toptier_code: '052', agency_id:  52, abbreviation: 'CNCS',   agency_name: 'Corporation for National and Community Service' },
  { toptier_code: '059', agency_id:  59, abbreviation: 'TVA',    agency_name: 'Tennessee Valley Authority' },
  { toptier_code: '060', agency_id:  60, abbreviation: 'DNFSB',  agency_name: 'Defense Nuclear Facilities Safety Board' },
  { toptier_code: '061', agency_id:  61, abbreviation: 'CFPB',   agency_name: 'Consumer Financial Protection Bureau' },
  { toptier_code: '062', agency_id:  62, abbreviation: 'IMLS',   agency_name: 'Institute of Museum and Library Services' },
  { toptier_code: '064', agency_id:  64, abbreviation: 'AFRH',   agency_name: 'Armed Forces Retirement Home' },
  { toptier_code: '078', agency_id:  78, abbreviation: 'FMC',    agency_name: 'Federal Maritime Commission' },
  { toptier_code: '079', agency_id:  79, abbreviation: 'PBGC',   agency_name: 'Pension Benefit Guaranty Corporation' },
  { toptier_code: '082', agency_id:  82, abbreviation: 'FLRA',   agency_name: 'Federal Labor Relations Authority' },
  { toptier_code: '083', agency_id:  83, abbreviation: 'OGE',    agency_name: 'Office of Government Ethics' },
  { toptier_code: '084', agency_id:  84, abbreviation: 'MSPB',   agency_name: 'Merit Systems Protection Board' },
  { toptier_code: '088', agency_id:  88, abbreviation: 'PCLOB',  agency_name: 'Privacy and Civil Liberties Oversight Board' },
  { toptier_code: '090', agency_id:  90, abbreviation: 'AC',     agency_name: 'Appalachian Regional Commission' },
  { toptier_code: '093', agency_id:  93, abbreviation: 'DRBC',   agency_name: 'Delta Regional Authority' },
  { toptier_code: '094', agency_id:  94, abbreviation: 'MCC',    agency_name: 'Millennium Challenge Corporation' },
  { toptier_code: '096', agency_id:  96, abbreviation: 'USACE',  agency_name: 'U.S. Army Corps of Engineers - Civil Works' },
  { toptier_code: '100', agency_id: 100, abbreviation: 'NEH',    agency_name: 'National Endowment for the Humanities' },
  { toptier_code: '101', agency_id: 101, abbreviation: 'NEA',    agency_name: 'National Endowment for the Arts' },
  { toptier_code: '104', agency_id: 104, abbreviation: 'NGA',    agency_name: 'National Geospatial-Intelligence Agency' },
  { toptier_code: '110', agency_id: 110, abbreviation: 'USTDA',  agency_name: 'Trade and Development Agency' },
  { toptier_code: '115', agency_id: 115, abbreviation: 'DFC',    agency_name: 'U.S. International Development Finance Corporation' },
  { toptier_code: '116', agency_id: 116, abbreviation: 'USAGM',  agency_name: 'U.S. Agency for Global Media' },
  { toptier_code: '246', agency_id: 246, abbreviation: 'OSHRC',  agency_name: 'Occupational Safety and Health Review Commission' },
  { toptier_code: '247', agency_id: 247, abbreviation: null,     agency_name: '400 Years of African-American History Commission' },
  { toptier_code: '302', agency_id: 302, abbreviation: null,     agency_name: 'Administrative Conference of the U.S.' },
  { toptier_code: '310', agency_id: 310, abbreviation: null,     agency_name: 'Access Board' },
  { toptier_code: '513', agency_id: 513, abbreviation: 'USAB',   agency_name: 'U.S. Access Board' },
  { toptier_code: '523', agency_id: 523, abbreviation: 'FASAB',  agency_name: 'Federal Accounting Standards Advisory Board' },
  { toptier_code: '533', agency_id: 533, abbreviation: 'HSTSC',  agency_name: 'Harry S. Truman Scholarship Foundation' },
  { toptier_code: '534', agency_id: 534, abbreviation: 'USIP',   agency_name: 'U.S. Institute of Peace' },
  { toptier_code: '540', agency_id: 540, abbreviation: 'FRTIB',  agency_name: 'Federal Retirement Thrift Investment Board' },
  { toptier_code: '548', agency_id: 548, abbreviation: 'USCCR',  agency_name: 'U.S. Commission on Civil Rights' },
];
