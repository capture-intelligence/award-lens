import { z } from 'zod';

export const UsaspendingRecipientSchema = z.object({
  recipient_id: z.string(),
  name: z.string().nullable().optional(),
  duns: z.string().nullable().optional(),
  uei: z.string().nullable().optional(),
  parent_id: z.string().nullable().optional(),
  parent_name: z.string().nullable().optional(),
  business_categories: z.array(z.string()).default([]),
  location: z.object({
    country_code: z.string().nullable().optional(),
    country_name: z.string().nullable().optional(),
    state_code: z.string().nullable().optional(),
    state_name: z.string().nullable().optional(),
    city_name: z.string().nullable().optional(),
    zip: z.string().nullable().optional(),
    congressional_code: z.string().nullable().optional(),
    address_line1: z.string().nullable().optional(),
  }).nullable().optional(),
  total_transactions: z.number().nullable().optional(),
  total_transaction_amount: z.number().nullable().optional(),
}).passthrough();

export type UsaspendingRecipient = z.infer<typeof UsaspendingRecipientSchema>;
