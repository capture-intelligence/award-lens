import { z } from 'zod';

/**
 * USAspending /search/spending_by_award/ response row.
 * We only validate the fields we actually use — extras are allowed.
 */
export const UsaspendingAwardRowSchema = z.object({
  'Award ID':             z.string().nullable().optional(),
  'Recipient Name':       z.string().nullable().optional(),
  'Recipient UEI':        z.string().nullable().optional(),
  'Award Amount':         z.number().nullable().optional(),
  'Total Outlays':        z.number().nullable().optional(),
  'Description':          z.string().nullable().optional(),
  'Contract Award Type':  z.string().nullable().optional(),
  'Start Date':           z.string().nullable().optional(),
  'End Date':             z.string().nullable().optional(),
  'Awarding Agency':      z.string().nullable().optional(),
  'Awarding Sub Agency':  z.string().nullable().optional(),
  'Awarding Office Code': z.string().nullable().optional(),
  'Awarding Office Name': z.string().nullable().optional(),
  'Funding Agency':       z.string().nullable().optional(),
  'Funding Office Code':  z.string().nullable().optional(),
  'Funding Office Name':  z.string().nullable().optional(),
  'NAICS':                z.string().nullable().optional(),
  'PSC':                  z.string().nullable().optional(),
  'Last Modified Date':   z.string().nullable().optional(),
  'generated_internal_id': z.string(),
  // Recipient-enriched fields (when requested)
  'recipient_id':         z.string().nullable().optional(),
  'Place of Performance State Code': z.string().nullable().optional(),
  'Place of Performance Country Code': z.string().nullable().optional(),
}).passthrough();

export type UsaspendingAwardRow = z.infer<typeof UsaspendingAwardRowSchema>;

export const UsaspendingSearchResponseSchema = z.object({
  results: z.array(UsaspendingAwardRowSchema),
  page_metadata: z.object({
    page: z.number(),
    hasNext: z.boolean(),
    last_record_unique_id: z.union([z.string(), z.number()]).nullable().optional(),
    last_record_sort_value: z.union([z.string(), z.number()]).nullable().optional(),
  }),
});

export type UsaspendingSearchResponse = z.infer<typeof UsaspendingSearchResponseSchema>;
