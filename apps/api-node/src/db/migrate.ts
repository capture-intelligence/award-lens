/**
 * Apply Drizzle-generated migrations from ./drizzle to the connected DB.
 * Run via `pnpm --filter @captureradar/api-node db:migrate`.
 */
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import pg from 'pg';
import { loadEnv } from '../env.js';

const env = loadEnv();

async function main() {
  console.log('connecting to', maskDbUrl(env.DATABASE_URL));
  const client = new pg.Client({ connectionString: env.DATABASE_URL });
  await client.connect();
  const drz = drizzle(client);

  // Ensure required extensions exist before any migration runs.
  console.log('ensuring extensions: pg_trgm, vector, pgcrypto');
  await client.query('CREATE EXTENSION IF NOT EXISTS pg_trgm;');
  await client.query('CREATE EXTENSION IF NOT EXISTS pgcrypto;');
  await client.query('CREATE EXTENSION IF NOT EXISTS vector;');

  console.log('applying migrations…');
  await migrate(drz, { migrationsFolder: './drizzle' });
  console.log('done');

  await client.end();
}

function maskDbUrl(url: string): string {
  return url.replace(/\/\/([^:]+):([^@]+)@/, '//$1:***@');
}

main().catch((err) => {
  console.error('migration failed:', err);
  process.exit(1);
});
