/**
 * Heuristic that classifies an award row into a "Nature of work" bucket.
 *
 * Source signals (in order of weight):
 *   1. PSC description     — most precise (federal taxonomy)
 *   2. NAICS description   — industry context
 *   3. Award description   — the actual work statement
 *
 * Buckets are intentionally aligned with the worksheet's classification:
 *   Research / R&D
 *   Data / Surveillance Systems
 *   Communications / Outreach
 *   IT / Software
 *   Evaluation / Assessment
 *   Program Support / PMO
 *   Goods / Equipment
 *   Other / Mixed
 *
 * Order matters — earlier rules win, so put more specific ones first.
 */

interface AwardLike {
  description?: string | null;
  psc_description?: string | null;
  psc_code?: string | null;
  naics_description?: string | null;
  naics_code?: string | null;
}

/**
 * Canonical bucket list — every value `natureOfWork()` can return.
 * Exported so top-level filters (e.g. the Topbar nature picker) can render
 * the catalog without first scanning the dataset.
 */
export const NATURE_BUCKETS = [
  'Research / R&D',
  'Data / Surveillance Systems',
  'IT / Software',
  'Communications / Outreach',
  'Evaluation / Assessment',
  'Program Support / PMO',
  'Goods / Equipment',
  'Other / Mixed',
] as const;
export type NatureBucket = typeof NATURE_BUCKETS[number];

export function natureOfWork(row: AwardLike): string {
  const text = [
    row.description ?? '',
    row.psc_description ?? '',
    row.naics_description ?? '',
  ].join(' ').toUpperCase();

  // PSC code prefixes (most authoritative when present)
  const psc = (row.psc_code ?? '').toUpperCase();
  if (psc.startsWith('A'))    return 'Research / R&D';            // PSC A = Research and Development
  if (psc.startsWith('R408')) return 'Program Support / PMO';     // R408 = Program Mgmt / Support Svcs
  if (psc.startsWith('R4'))   return 'Program Support / PMO';     // R4xx = Support / consulting svcs
  if (psc.startsWith('R7'))   return 'Communications / Outreach'; // R7xx = Logistics / training svcs
  if (psc.startsWith('D'))    return 'IT / Software';             // PSC D = ADP / IT services
  if (psc.startsWith('B5'))   return 'Research / R&D';            // B5xx = Special studies / analyses
  if (/^[1-9]/.test(psc))     return 'Goods / Equipment';         // numeric PSCs = products

  // Description-based fallbacks
  if (/RESEARCH AND DEVELOPMENT|R&D|CLINICAL TRIAL|EXPERIMENT|RESEARCH PROGRAM/.test(text))
    return 'Research / R&D';

  if (/SURVEILLANCE SYSTEM|SURVEILLANCE OF|MONITORING SYSTEM|REGISTRY|EPIDEMIOLOG/.test(text))
    return 'Data / Surveillance Systems';

  if (/INFORMATIC|DATA COORDINATING|DATA WAREHOUSE|DATA MODERNIZATION|DATABASE/.test(text))
    return 'Data / Surveillance Systems';

  if (/SOFTWARE|COMPUTER SYSTEMS|INFORMATION SYSTEM|IT INFRASTRUCTURE|CLOUD|PLATFORM/.test(text))
    return 'IT / Software';

  if (/COMMUNICATION|OUTREACH|MEDIA CAMPAIGN|MARKETING|TRAINING SERVICES|EDUCATION/.test(text))
    return 'Communications / Outreach';

  if (/EVALUATION|ASSESSMENT|ANALYTIC SUPPORT|PROGRAM REVIEW|IMPACT ANALYSIS/.test(text))
    return 'Evaluation / Assessment';

  if (/CONSULTING|MANAGEMENT SUPPORT|ADMINISTRATIVE|PMO|PROGRAM SUPPORT|TECHNICAL SUPPORT/.test(text))
    return 'Program Support / PMO';

  if (/EQUIPMENT|SUPPLIES|PURCHASE OF|PRODUCT|HARDWARE/.test(text))
    return 'Goods / Equipment';

  if (/GENERAL SERVICES|MISCELLANEOUS/.test(text))
    return 'Other / Mixed';

  return 'Other / Mixed';
}
