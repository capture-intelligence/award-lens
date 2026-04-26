/**
 * USAspending award type codes — labeled.
 *
 * Used in the view editor's multi-select. Default for new "contract" views
 * is the four canonical procurement types (A,B,C,D); grant views typically
 * pick from 02–05.
 */

export interface AwardType {
  code: string;
  label: string;
  group: 'contract' | 'grant' | 'idv' | 'other';
}

export const AWARD_TYPES: AwardType[] = [
  // Procurement contracts
  { code: 'A', label: 'BPA Call',                      group: 'contract' },
  { code: 'B', label: 'Purchase Order',                group: 'contract' },
  { code: 'C', label: 'Delivery Order',                group: 'contract' },
  { code: 'D', label: 'Definitive Contract',           group: 'contract' },

  // Indefinite-Delivery Vehicles (parent agreements)
  { code: 'IDV_A', label: 'IDV — GWAC',                group: 'idv' },
  { code: 'IDV_B', label: 'IDV — IDC',                 group: 'idv' },
  { code: 'IDV_C', label: 'IDV — FSS',                 group: 'idv' },
  { code: 'IDV_D', label: 'IDV — BOA',                 group: 'idv' },
  { code: 'IDV_E', label: 'IDV — BPA',                 group: 'idv' },

  // Financial assistance / grants
  { code: '02', label: 'Block Grant',                  group: 'grant' },
  { code: '03', label: 'Formula Grant',                group: 'grant' },
  { code: '04', label: 'Project Grant',                group: 'grant' },
  { code: '05', label: 'Cooperative Agreement',        group: 'grant' },
  { code: '06', label: 'Direct Payment (Specified)',   group: 'grant' },
  { code: '07', label: 'Direct Loan',                  group: 'grant' },
  { code: '08', label: 'Guaranteed Loan',              group: 'grant' },
  { code: '09', label: 'Insurance',                    group: 'grant' },
  { code: '10', label: 'Direct Payment (Unrestricted)',group: 'grant' },
  { code: '11', label: 'Other Financial Assistance',   group: 'grant' },
];

export const AWARD_TYPE_GROUPS = [
  { id: 'contract', label: 'Contracts' },
  { id: 'idv',      label: 'IDVs' },
  { id: 'grant',    label: 'Grants & Assistance' },
] as const;

/** Sensible defaults when creating a new view: procurement contracts only. */
export const DEFAULT_AWARD_TYPES = ['A', 'B', 'C', 'D'];

export const LOOKBACK_PRESETS = [
  { value: 3,  label: '3 months' },
  { value: 6,  label: '6 months' },
  { value: 12, label: '1 year' },
  { value: 18, label: '18 months' },
  { value: 24, label: '2 years' },
  { value: 36, label: '3 years' },
  { value: 60, label: '5 years' },
];
