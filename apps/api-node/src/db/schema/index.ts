/**
 * Re-export every schema module so `drizzle.config.ts` can find every table
 * with one import path, and so app code can `import { contract_opportunities }
 * from '../db/schema/index.js'`.
 */
export * from './auth.js';
export * from './reference.js';
export * from './agencies.js';
export * from './awardees.js';
export * from './people.js';
export * from './opportunities.js';
export * from './awards.js';
export * from './vehicles.js';
export * from './documents.js';
export * from './protests.js';
export * from './programs.js';
export * from './classifications.js';
export * from './labor-news.js';
export * from './capital-markets.js';
export * from './user-generated.js';
