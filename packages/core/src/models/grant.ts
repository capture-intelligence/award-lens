import { z } from 'zod';

/**
 * Grants.gov /v1/api/search2 response shape.
 * Fields are loosely typed because Grants.gov emits strings for numbers
 * and MM/DD/YYYY dates inconsistently.
 */
export const GrantsGovSearchHitSchema = z.object({
  id: z.union([z.string(), z.number()]),
  number: z.string().nullable().optional(),
  title: z.string().nullable().optional(),
  agencyCode: z.string().nullable().optional(),
  agencyName: z.string().nullable().optional(),
  openDate: z.string().nullable().optional(),      // MM/DD/YYYY
  closeDate: z.string().nullable().optional(),     // MM/DD/YYYY or empty
  docType: z.string().nullable().optional(),       // 'synopsis' | 'forecast'
  oppStatus: z.string().nullable().optional(),     // 'posted' | 'forecasted' | 'closed' | 'archived'
  alnist: z.array(z.string()).nullable().optional(),
  cfdaList: z.array(z.string()).nullable().optional(),
}).passthrough();

export type GrantsGovSearchHit = z.infer<typeof GrantsGovSearchHitSchema>;

export const GrantsGovSearchResponseSchema = z.object({
  errorcode: z.number(),
  msg: z.string(),
  data: z.object({
    hitCount: z.number(),
    oppHits: z.array(GrantsGovSearchHitSchema),
    startRecord: z.number().optional(),
  }),
});

export type GrantsGovSearchResponse = z.infer<typeof GrantsGovSearchResponseSchema>;

export const GrantsGovOpportunityDetailSchema = z.object({
  id: z.union([z.string(), z.number()]),
  opportunityNumber: z.string().nullable().optional(),
  opportunityTitle: z.string().nullable().optional(),
  owningAgencyCode: z.string().nullable().optional(),
  agencyName: z.string().nullable().optional(),
  category: z.string().nullable().optional(),
  categoryExplanation: z.string().nullable().optional(),
  fundingInstruments: z.array(z.object({
    description: z.string(),
  })).nullable().optional(),
  cfdas: z.array(z.object({
    cfdaNumber: z.string(),
    programTitle: z.string().nullable().optional(),
  })).nullable().optional(),
  synopsis: z.object({
    synopsisDesc: z.string().nullable().optional(),
    responseDate: z.string().nullable().optional(),
    postingDate: z.string().nullable().optional(),
    archiveDate: z.string().nullable().optional(),
    estimatedFunding: z.union([z.string(), z.number()]).nullable().optional(),
    awardCeiling: z.union([z.string(), z.number()]).nullable().optional(),
    awardFloor: z.union([z.string(), z.number()]).nullable().optional(),
    expectedNumberOfAwards: z.union([z.string(), z.number()]).nullable().optional(),
  }).nullable().optional(),
  eligibilityList: z.array(z.object({
    code: z.string(),
  })).nullable().optional(),
}).passthrough();

export type GrantsGovOpportunityDetail = z.infer<typeof GrantsGovOpportunityDetailSchema>;
