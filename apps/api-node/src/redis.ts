/**
 * Redis client used for: BullMQ broker, response caching, session lookups.
 *
 * BullMQ requires its own connection (cannot share with general use). We
 * expose two clients:
 *   - `redis`        general-purpose (cache, counters, ratelimits)
 *   - `bullmqRedis`  dedicated to BullMQ — must have maxRetriesPerRequest=null
 */
import { Redis } from 'ioredis';
import { loadEnv } from './env.js';

const env = loadEnv();

export const redis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  maxRetriesPerRequest: 3,
});

export const bullmqRedis = new Redis(env.REDIS_URL, {
  lazyConnect: false,
  // BullMQ requirement — null keeps reconnecting forever instead of throwing.
  maxRetriesPerRequest: null,
});

redis.on('error', (err) => console.error('redis error:', err));
bullmqRedis.on('error', (err) => console.error('bullmq redis error:', err));
