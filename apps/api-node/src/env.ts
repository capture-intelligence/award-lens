/**
 * Environment validation. Single source of truth for what env vars the API
 * reads — runtime crashes here at startup if anything is misconfigured.
 */
import { z } from 'zod';

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace']).default('info'),

  DATABASE_URL: z.string().url(),
  PG_POOL_MAX: z.coerce.number().int().positive().default(10),

  REDIS_URL: z.string().url(),

  SESSION_COOKIE: z.string().default('awards_session'),
  PUBLIC_BASE_URL: z.string().url().default('https://awards-dashboard.pages.dev'),
  CORS_ORIGINS: z
    .string()
    .default('https://awards-dashboard.pages.dev,http://localhost:5173')
    .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean)),
  ADMIN_BOOTSTRAP_EMAIL: z.string().email().default('algocrat@gmail.com'),

  CF_ACCOUNT_ID: z.string().optional(),
  CF_WORKERS_AI_TOKEN: z.string().optional(),
  CF_AI_GENERATION_MODEL: z
    .string()
    .default('@cf/meta/llama-3.3-70b-instruct-fp8-fast'),
  CF_AI_EMBEDDING_MODEL: z.string().default('@cf/baai/bge-base-en-v1.5'),

  ANTHROPIC_API_KEY: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  ALERT_FROM_EMAIL: z.string().email().default('alerts@captureradar.app'),

  SAM_GOV_API_KEY: z.string().optional(),
  INGEST_TOKEN: z.string().optional(),

  R2_ACCOUNT_ID: z.string().optional(),
  R2_ACCESS_KEY_ID: z.string().optional(),
  R2_SECRET_ACCESS_KEY: z.string().optional(),
  R2_BUCKET: z.string().default('captureradar-documents'),
  R2_PUBLIC_URL: z.string().optional(),

  INGESTION_MODE: z.enum(['live', 'seed', 'mixed']).default('mixed'),
  WORKERS_AI_DAILY_BUDGET: z.coerce.number().int().positive().default(8000),
});

export type Env = z.infer<typeof envSchema>;

let cachedEnv: Env | null = null;

export function loadEnv(): Env {
  if (cachedEnv) return cachedEnv;
  const parsed = envSchema.safeParse(process.env);
  if (!parsed.success) {
    console.error('Invalid environment configuration:');
    for (const issue of parsed.error.issues) {
      console.error(`  ${issue.path.join('.')}: ${issue.message}`);
    }
    process.exit(1);
  }
  cachedEnv = parsed.data;
  return cachedEnv;
}

export function isProduction(): boolean {
  return loadEnv().NODE_ENV === 'production';
}
