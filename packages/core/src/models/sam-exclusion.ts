import { z } from 'zod';

/**
 * SAM.gov Exclusions Public Extract — canonical row shape (post-parse).
 * Column names follow SAM's CSV headers (they occasionally shift — see
 * the README in the extract ZIP for the current column list).
 */
export const SamExclusionRowSchema = z.object({
  'Classification':       z.string().optional(),        // 'Firm' | 'Individual' | ...
  'Name':                 z.string(),
  'Prefix':               z.string().optional(),
  'First':                z.string().optional(),
  'Middle':               z.string().optional(),
  'Last':                 z.string().optional(),
  'Suffix':               z.string().optional(),
  'Address 1':            z.string().optional(),
  'Address 2':            z.string().optional(),
  'City':                 z.string().optional(),
  'State / Province':     z.string().optional(),
  'Country':              z.string().optional(),
  'Zip Code':             z.string().optional(),
  'UEI':                  z.string().optional(),
  'DUNS':                 z.string().optional(),
  'CAGE':                 z.string().optional(),
  'NPI':                  z.string().optional(),
  'Exclusion Program':    z.string().optional(),        // 'Reciprocal','Non-Procurement','Procurement'
  'Excluding Agency':     z.string().optional(),
  'CT Code':              z.string().optional(),
  'Exclusion Type':       z.string().optional(),        // 'Debarment','Suspension','Prohibition','Proposed Debarment'
  'Additional Comments':  z.string().optional(),
  'Active Date':          z.string().optional(),        // M/D/YYYY
  'Termination Date':     z.string().optional(),        // Indefinite | M/D/YYYY
  'Record Status':        z.string().optional(),        // 'Active' | 'Inactive'
  'Cross-Reference':      z.string().optional(),
  'Exclusion Id':         z.string().optional(),        // SAM internal ID
  'SAM Number':           z.string().optional(),
}).passthrough();

export type SamExclusionRow = z.infer<typeof SamExclusionRowSchema>;
