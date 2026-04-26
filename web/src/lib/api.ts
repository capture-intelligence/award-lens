/**
 * API client. The API is proxied through the dashboard's own origin via a
 * Cloudflare Pages Function (web/functions/_middleware.ts), so requests are
 * same-origin and the session cookie is first-party.
 *
 * Override possible via localStorage `awards.api_base` for local dev against
 * the worker directly.
 */

declare global {
  interface Window {
    AWARDS_CONFIG?: { API_BASE?: string };
  }
}

const LS_KEY = 'awards.api_base';
/** Empty string = same-origin (relative URLs). */
const DEFAULT_API_BASE = '';

export function apiBase(): string {
  if (typeof window === 'undefined') return DEFAULT_API_BASE;
  return (
    localStorage.getItem(LS_KEY) ??
    window.AWARDS_CONFIG?.API_BASE ??
    DEFAULT_API_BASE
  );
}

export function setApiBase(url: string) {
  localStorage.setItem(LS_KEY, url.trim().replace(/\/$/, ''));
}

export class ApiError extends Error {
  constructor(public status: number, public body: unknown) {
    super(`API ${status}`);
  }
}

async function request<T>(method: string, path: string, opts?: { body?: unknown; query?: Record<string, unknown> }): Promise<T> {
  const base = apiBase();
  // If base is empty (same-origin), build URL relative to current location.
  // If base is a full URL, build against that.
  const baseForURL = base || (typeof window !== 'undefined' ? window.location.origin : 'http://localhost');
  const url = new URL(path, baseForURL);
  for (const [k, v] of Object.entries(opts?.query ?? {})) {
    if (v !== undefined && v !== null && v !== '') url.searchParams.set(k, String(v));
  }
  // Same-origin: pass relative path; cross-origin: pass full URL.
  const fetchTarget = base ? url.toString() : url.pathname + url.search;
  const r = await fetch(fetchTarget, {
    method,
    credentials: 'include',
    headers: opts?.body !== undefined ? { 'content-type': 'application/json' } : undefined,
    body: opts?.body !== undefined ? JSON.stringify(opts.body) : undefined,
  });
  let body: unknown = null;
  try { body = await r.json(); } catch { /* tolerate empty bodies */ }
  if (!r.ok) throw new ApiError(r.status, body);
  return body as T;
}

export const api = {
  get:  <T,>(path: string, query?: Record<string, unknown>) => request<T>('GET',  path, { query }),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, { body }),
  put:  <T,>(path: string, body?: unknown) => request<T>('PUT',  path, { body }),
  del:  <T,>(path: string) => request<T>('DELETE', path),
};
