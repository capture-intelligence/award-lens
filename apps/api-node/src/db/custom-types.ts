/**
 * Drizzle custom column types we need across the schema.
 */
import { customType } from 'drizzle-orm/pg-core';

/**
 * pgvector — fixed-dimension dense vector column. Use the embedding model's
 * dimension (768 for bge-base-en-v1.5).
 *
 *   description_embedding: vector('description_embedding', 768)
 *
 * Requires `CREATE EXTENSION vector` in the database (handled by the install
 * script + the 0001_extensions migration).
 */
export const vector = customType<{ data: number[]; driverData: string; config: { dimensions: number } }>({
  dataType(config) {
    if (!config?.dimensions) throw new Error('vector column requires { dimensions }');
    return `vector(${config.dimensions})`;
  },
  toDriver(value: number[]): string {
    return `[${value.join(',')}]`;
  },
  fromDriver(value: string): number[] {
    // Postgres returns "[0.1,0.2,...]" — strip brackets and parse.
    if (typeof value === 'string') {
      return value.replace(/^\[|\]$/g, '').split(',').map(Number);
    }
    return value as unknown as number[];
  },
});

/**
 * tsvector — Postgres full-text search vector. We keep it as a generated
 * column populated from title + description via raw SQL in the migration;
 * the type wrapper exists for read paths.
 */
export const tsvector = customType<{ data: string; driverData: string }>({
  dataType() {
    return 'tsvector';
  },
});
