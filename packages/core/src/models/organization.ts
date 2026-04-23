import { z } from 'zod';

export const UsaspendingToptierAgencySchema = z.object({
  agency_id: z.number(),
  toptier_code: z.string(),
  abbreviation: z.string().nullable().optional(),
  agency_name: z.string(),
  congressional_justification_url: z.string().nullable().optional(),
  active_fy: z.string().nullable().optional(),
  active_fq: z.string().nullable().optional(),
  outlay_amount: z.number().nullable().optional(),
  obligated_amount: z.number().nullable().optional(),
}).passthrough();

export type UsaspendingToptierAgency = z.infer<typeof UsaspendingToptierAgencySchema>;
