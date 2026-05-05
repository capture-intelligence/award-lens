/**
 * Postgres connection — node-postgres pool wrapped by Drizzle.
 * One pool per process; reused by every request handler and BullMQ worker.
 */
import pg from 'pg';
import { drizzle } from 'drizzle-orm/node-postgres';
import { loadEnv } from '../env.js';
import * as schema from './schema/index.js';

const env = loadEnv();

export const pool = new pg.Pool({
  connectionString: env.DATABASE_URL,
  max: env.PG_POOL_MAX,
  idleTimeoutMillis: 30_000,
});

pool.on('error', (err) => {
  console.error('pg pool error:', err);
});

export const db = drizzle(pool, { schema, casing: 'snake_case' });

export type DB = typeof db;
export { schema };
