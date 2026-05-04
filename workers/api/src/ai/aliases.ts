/**
 * Entity-alias module — two responsibilities:
 *
 *   1. Builder (admin) — POST /ai/build-aliases sweeps vendor /
 *      organization / cdc_center, asks Claude to enumerate likely
 *      user-typed abbreviations for each, persists into entity_alias.
 *      One-time / periodic; not in the chat hot path.
 *
 *   2. Resolver (chat) — at /ai/v2/ask time, extract candidate name
 *      tokens from the user's question (uppercase acronyms,
 *      capitalized words) and look them up in entity_alias. Resolved
 *      entities are injected into M1's prompt as ground truth so the
 *      generated SQL uses canonical names + the right schema patterns.
 */

import type { Context } from 'hono';
import type { D1Database } from '@cloudflare/workers-types';
import type { Env } from '../index.js';
import type { AuthVars } from '../auth/session.js';

const ANTHROPIC_ENDPOINT = 'https://api.anthropic.com/v1/messages';
const ANTHROPIC_MODEL    = 'claude-sonnet-4-5';

// ─── Resolver — chat-time lookup ────────────────────────────────────────────

export interface ResolvedEntity {
  alias:           string;
  entity_kind:     'vendor' | 'organization' | 'center';
  canonical_id:    string | null;
  canonical_name:  string;
}

/** Tokens we don't want to look up — common English / question chrome. */
const STOP_TOKENS = new Set([
  'HOW','MANY','MUCH','WHAT','WHEN','WHERE','WHY','WHO','WHICH','THE','A','AN','AND','OR','BUT',
  'WITH','FOR','BY','TO','OF','IN','ON','AT','IS','ARE','WAS','WERE','BE','BEEN','BEING','HAS',
  'HAVE','HAD','DO','DOES','DID','CAN','COULD','SHOULD','WOULD','MAY','MIGHT','MUST','SHALL',
  'WILL','THIS','THAT','THESE','THOSE','IT','ITS','THEY','THEIR','THEM','HIM','HER','HE','SHE',
  'CONTRACT','CONTRACTS','AWARD','AWARDS','VENDOR','VENDORS','AGENCY','AGENCIES','CENTER',
  'CENTERS','ACTIVE','TOTAL','FROM','UNDER','ABOUT','SHOW','LIST','GIVE','ME','YOU','US','ALL',
  'ANY','SOME','MORE','LESS','LIKE','SIMILAR','TYPE','DAYS','DAY','MONTHS','MONTH','YEARS','YEAR',
]);

/**
 * Pull candidate entity tokens from a user question.
 *
 * Heuristics (deliberately simple — we let entity_alias's UNIQUE
 * indexes filter the noise):
 *   - All-caps acronyms 2–10 chars: NCHHSTP, BAH, CDC, RTI
 *   - Capitalized words ≥ 4 chars:  Lantana, Booz, Allen
 *   - Multi-word capitalized phrases: "Research Triangle"
 *   - Anything in STOP_TOKENS removed
 */
export function extractCandidates(question: string): string[] {
  // 1) all-caps acronyms
  const acronyms  = (question.match(/\b[A-Z]{2,10}\b/g) ?? [])
    .filter((t) => !STOP_TOKENS.has(t.toUpperCase()));
  // 2) capitalized single words
  const capitals  = (question.match(/\b[A-Z][a-z]{3,}\b/g) ?? [])
    .filter((t) => !STOP_TOKENS.has(t.toUpperCase()));
  // 3) consecutive capitalized words (bigrams up to trigrams)
  const phrases: string[] = [];
  const words = question.split(/\s+/);
  for (let i = 0; i < words.length - 1; i++) {
    const a = words[i], b = words[i + 1];
    if (/^[A-Z][a-z]+$/.test(a) && /^[A-Z][a-z]+$/.test(b)) {
      phrases.push(`${a} ${b}`);
      const c = words[i + 2];
      if (c && /^[A-Z][a-z]+$/.test(c)) phrases.push(`${a} ${b} ${c}`);
    }
  }
  return Array.from(new Set([...phrases, ...acronyms, ...capitals])).slice(0, 8);
}

/** Look up candidate tokens in entity_alias. Returns at most 8 hits. */
export async function resolveEntities(
  db: D1Database,
  question: string,
): Promise<ResolvedEntity[]> {
  const candidates = extractCandidates(question);
  if (candidates.length === 0) return [];

  const lower = candidates.map((t) => t.toLowerCase());
  const placeholders = lower.map(() => '?').join(', ');
  const stmt = `
    SELECT alias, entity_kind, canonical_id, canonical_name
    FROM   entity_alias
    WHERE  alias_lower IN (${placeholders})
    LIMIT  16
  `;
  const result = await db.prepare(stmt).bind(...lower).all<ResolvedEntity>();
  return result.results ?? [];
}

// ─── Builder — POST /ai/build-aliases ──────────────────────────────────────

interface VendorRow { vendor_id: string; legal_name: string; n: number }
interface OrgRow    { org_id:    string; canonical_name: string; short_name: string | null }
interface CenterRow { center_code: string; center_name: string }

const BUILDER_SYSTEM = `You are building a name → abbreviations lookup for a federal procurement search system. For each entity, list 1–6 short abbreviations or aliases a user would realistically type when searching for it.

Include:
  - Acronyms from initial letters of words ("Research Triangle Institute" → "RTI")
  - Common short forms ("Booz Allen Hamilton" → "BAH", "Booz Allen", "Booz")
  - Removing legal suffixes (", LLC", ", INC", ", CORPORATION", ", L.L.C.", "INCORPORATED")
  - Single words from a longer name when distinctive ("Lockheed Martin Corporation" → "Lockheed")

Do NOT invent abbreviations that no one would actually type. Skip generic terms ("INC", "LLC", "GROUP", "SERVICES") on their own.

Return ONLY a JSON array, one element per input row:
[{"id": "<the row's id>", "aliases": ["RTI", "Research Triangle"]}]

Order doesn't matter. If a row has no useful abbreviation, return an empty aliases array — do not omit the row.`;

/** Send one batch of names to Claude; return parsed alias list.
 *
 * Claude occasionally wraps the array in an object like
 * { results: [...] } / { aliases: [...] }, or prefixes with prose. We
 * defensively unwrap and slice the first/last brackets so all reasonable
 * shapes parse. Throws with a snippet of the raw text if even that fails,
 * so the caller can capture the diagnostic.
 */
async function aliasBatch(
  apiKey: string,
  prompt: string,
): Promise<Array<{ id: string; aliases: string[] }>> {
  const resp = await fetch(ANTHROPIC_ENDPOINT, {
    method: 'POST',
    headers: {
      'x-api-key':         apiKey,
      'anthropic-version': '2023-06-01',
      'content-type':      'application/json',
    },
    body: JSON.stringify({
      model:      ANTHROPIC_MODEL,
      max_tokens: 4096,
      system:     BUILDER_SYSTEM,
      messages:   [{ role: 'user', content: prompt }],
    }),
  });
  if (!resp.ok) {
    throw new Error(`Anthropic ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
  }
  const data = await resp.json() as { content: { type: string; text: string }[] };
  const text = data.content.filter((b) => b.type === 'text').map((b) => b.text).join('').trim();

  // Strip markdown fences first.
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  let candidate = (fenced ? fenced[1] : text).trim();

  // If Claude prefixed prose ("Here are the aliases:") then a JSON
  // array, slice from the first `[` to the matching last `]`.
  if (!candidate.startsWith('[') && !candidate.startsWith('{')) {
    const firstBracket = candidate.indexOf('[');
    const lastBracket  = candidate.lastIndexOf(']');
    if (firstBracket >= 0 && lastBracket > firstBracket) {
      candidate = candidate.slice(firstBracket, lastBracket + 1);
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(candidate);
  } catch {
    throw new Error(`unparseable JSON: ${text.slice(0, 240)}`);
  }

  // Accept either a bare array OR an object whose first array-valued
  // property is the result list (Claude sometimes wraps as
  // { results: [...] }, { aliases: [...] }, or { entities: [...] }).
  if (Array.isArray(parsed)) {
    return parsed as Array<{ id: string; aliases: string[] }>;
  }
  if (parsed && typeof parsed === 'object') {
    for (const v of Object.values(parsed as Record<string, unknown>)) {
      if (Array.isArray(v)) {
        return v as Array<{ id: string; aliases: string[] }>;
      }
    }
  }
  throw new Error(`expected JSON array, got: ${text.slice(0, 240)}`);
}

function chunk<T>(xs: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < xs.length; i += size) out.push(xs.slice(i, i + size));
  return out;
}

// ─── Deterministic aliasing (no LLM) ────────────────────────────────────────
//
// Mechanical rules that catch the most common abbreviations users type:
//   1. Strip legal suffixes (", INC", ", LLC", "CORPORATION", …)
//   2. Initial-letter acronym for 2–6 word names ("RESEARCH TRIANGLE
//      INSTITUTE" → "RTI", "BOOZ ALLEN HAMILTON" → "BAH")
//   3. First significant word for multi-word names ("LANTANA CONSULTING
//      GROUP" → "LANTANA")
// Doesn't need Anthropic; runs free, deterministic, fast. Used always —
// Claude is only run on top to fill cases regex can't reach.

const SUFFIX_RX = /,?\s+(L\.L\.C\.?|LLC|L\.P\.|LP|LLP|INC\.?|INCORPORATED|CORPORATION|CORP\.?|CO\.?|COMPANY|HOLDINGS|GROUP|SERVICES|SOLUTIONS|TECHNOLOGIES|TECHNOLOGY|SYSTEMS|ENTERPRISES|PARTNERS|ASSOCIATES|LIMITED|LTD\.?|N\.A\.|PLC)\.?$/gi;

const SHORT_STOPWORDS = new Set([
  'INC','LLC','LP','LLP','CO','CORP','GROUP','SERVICES','SOLUTIONS','TECH',
  'TECHNOLOGIES','SYSTEMS','THE','OF','AND','FOR','IN','ON','AT',
]);

function deterministicVendorAliases(name: string): string[] {
  const out = new Set<string>();
  const trimmed = name.trim();
  if (!trimmed) return [];

  // 1. Strip suffixes — repeatedly so multi-suffix names ("FOO LLC, INC")
  //    get fully reduced. Each intermediate form is also a candidate.
  let stripped = trimmed;
  for (let i = 0; i < 4; i++) {
    const next = stripped.replace(SUFFIX_RX, '').trim().replace(/[,\s]+$/, '');
    if (next === stripped || !next) break;
    if (next.length >= 3) out.add(next);
    stripped = next;
  }

  const words = stripped.split(/\s+/).filter(Boolean);

  // 2. Initial-letter acronym for 2-6 word names. Skip stopwords like "OF".
  if (words.length >= 2 && words.length <= 6) {
    const meaningful = words.filter((w) => !SHORT_STOPWORDS.has(w.toUpperCase()));
    if (meaningful.length >= 2 && meaningful.length <= 5) {
      const acronym = meaningful
        .map((w) => (/^[A-Za-z]/.test(w) ? w[0]! : ''))
        .join('')
        .toUpperCase();
      if (acronym.length >= 2 && acronym.length <= 6) out.add(acronym);
    }
  }

  // 3. First significant word ≥ 4 chars (good for distinctive names like
  //    "LANTANA …", "LOCKHEED …"; skipped for generic-first-word names like
  //    "GENERAL DYNAMICS" where the second word is the distinctive one).
  if (words.length >= 2 && words[0].length >= 4 &&
      !SHORT_STOPWORDS.has(words[0].toUpperCase())) {
    out.add(words[0]);
  }

  // 4. First two significant words (catches "Booz Allen", "Lockheed Martin")
  if (words.length >= 3 && words[0].length >= 3 && words[1].length >= 3) {
    const phrase = `${words[0]} ${words[1]}`;
    if (phrase.length >= 6 && phrase.length <= 30) out.add(phrase);
  }

  // De-dup against canonical (case-insensitive) and reject any aliases
  // identical to the source name.
  const canonical = trimmed.toLowerCase();
  return Array.from(out).filter((a) => a.toLowerCase() !== canonical);
}

/** Insert a batch of aliases. Uses INSERT OR IGNORE against the unique index. */
async function persistAliases(
  db: D1Database,
  kind: 'vendor' | 'organization' | 'center',
  rows: Array<{ canonical_id: string | null; canonical_name: string; aliases: string[] }>,
): Promise<number> {
  const ts = new Date().toISOString();
  let inserted = 0;
  // D1 doesn't support arbitrary multi-row inserts cleanly; loop and batch.
  const stmt = db.prepare(`
    INSERT OR IGNORE INTO entity_alias
      (alias, alias_lower, entity_kind, canonical_id, canonical_name, source, created_at)
    VALUES (?, ?, ?, ?, ?, 'claude', ?)
  `);
  for (const row of rows) {
    for (const raw of row.aliases) {
      const alias = raw.trim();
      if (!alias || alias.length > 64) continue;
      // Skip aliases that are identical to the canonical name — no value
      // adding those, the LIKE match would catch them anyway.
      if (alias.toLowerCase() === row.canonical_name.toLowerCase()) continue;
      const r = await stmt.bind(
        alias, alias.toLowerCase(), kind, row.canonical_id, row.canonical_name, ts,
      ).run();
      if (r.meta?.changes) inserted += r.meta.changes;
    }
  }
  return inserted;
}

export async function handleBuildAliases(
  c: Context<{ Bindings: Env; Variables: AuthVars }>,
): Promise<Response> {
  const user = c.var.user;
  if (!user || user.role !== 'admin') {
    return c.json({ error: 'forbidden' }, 403);
  }
  const apiKey = c.env.ANTHROPIC_API_KEY;
  if (!apiKey) return c.json({ error: 'anthropic_api_key_missing' }, 503);

  const db = c.env.DB;
  const summary: Record<string, { entities: number; aliases_inserted: number; errors: string[] }> = {
    vendor:       { entities: 0, aliases_inserted: 0, errors: [] },
    organization: { entities: 0, aliases_inserted: 0, errors: [] },
    center:       { entities: 0, aliases_inserted: 0, errors: [] },
  };

  // Limit vendors to the most-active (by award count) so we don't pay
  // for thousands of low-value entities. The long tail can be added
  // incrementally on demand.
  const vendorMax = Math.min(Number(c.req.query('vendor_max') ?? 500), 2000);

  // ── Vendors ──────────────────────────────────────────────────────────
  const vendors = await db.prepare(`
    SELECT v.vendor_id, v.legal_name, COUNT(a.award_id) AS n
    FROM   vendor v
    JOIN   award  a ON a.vendor_id = v.vendor_id
    WHERE  v.legal_name IS NOT NULL AND TRIM(v.legal_name) != ''
    GROUP  BY v.vendor_id
    ORDER  BY n DESC
    LIMIT  ?
  `).bind(vendorMax).all<VendorRow>();
  summary.vendor.entities = vendors.results.length;

  // (1) Always seed with deterministic rules — no LLM dependency. Catches
  //     RTI, BAH, etc. via the initial-letter acronym rule + suffix
  //     stripping. Runs even when Anthropic is rate-limited.
  const vendorSeeded = vendors.results.map((v) => ({
    canonical_id:   v.vendor_id,
    canonical_name: v.legal_name,
    aliases:        deterministicVendorAliases(v.legal_name),
  }));
  summary.vendor.aliases_inserted += await persistAliases(db, 'vendor', vendorSeeded);

  // (2) Try Claude on top, but stop the whole pass at the first
  //     "API usage limits" 400 — no point burning latency on every
  //     batch if the cap is hit.
  let claudeUsable = true;
  for (const batch of chunk(vendors.results, 30)) {
    if (!claudeUsable) break;
    const prompt = batch.map((v) => `${v.vendor_id}: ${v.legal_name}`).join('\n');
    try {
      const out = await aliasBatch(apiKey, prompt);
      const map = new Map(out.map((o) => [o.id, o.aliases]));
      const persistRows = batch.map((v) => ({
        canonical_id:   v.vendor_id,
        canonical_name: v.legal_name,
        aliases:        map.get(v.vendor_id) ?? [],
      }));
      summary.vendor.aliases_inserted += await persistAliases(db, 'vendor', persistRows);
    } catch (err) {
      const msg = String(err);
      summary.vendor.errors.push(msg.slice(0, 240));
      if (/usage limits|rate.?limit|quota/i.test(msg)) {
        summary.vendor.errors.push('Anthropic rate-limited — skipping remaining vendor batches; deterministic aliases already inserted.');
        claudeUsable = false;
      }
    }
  }

  // ── Organizations (agency / sub-agency canonical names) ──────────────
  const orgs = await db.prepare(`
    SELECT org_id, canonical_name, short_name
    FROM   organization
    WHERE  canonical_name IS NOT NULL AND TRIM(canonical_name) != ''
  `).all<OrgRow>();
  summary.organization.entities = orgs.results.length;
  // For orgs we also seed short_name as a deterministic alias (no LLM
  // needed — the warehouse already stores "CDC" alongside "Centers for
  // Disease Control and Prevention"). Then ask Claude for the rest.
  const seededOrg: Array<{ canonical_id: string; canonical_name: string; aliases: string[] }> = [];
  for (const o of orgs.results) {
    if (o.short_name && o.short_name.toLowerCase() !== o.canonical_name.toLowerCase()) {
      seededOrg.push({
        canonical_id: o.org_id,
        canonical_name: o.canonical_name,
        aliases: [o.short_name],
      });
    }
  }
  summary.organization.aliases_inserted += await persistAliases(db, 'organization', seededOrg);
  let orgClaudeUsable = true;
  for (const batch of chunk(orgs.results, 40)) {
    if (!orgClaudeUsable) break;
    const prompt = batch.map((o) => `${o.org_id}: ${o.canonical_name}`).join('\n');
    try {
      const out = await aliasBatch(apiKey, prompt);
      const map = new Map(out.map((o) => [o.id, o.aliases]));
      const persistRows = batch.map((o) => ({
        canonical_id:   o.org_id,
        canonical_name: o.canonical_name,
        aliases:        map.get(o.org_id) ?? [],
      }));
      summary.organization.aliases_inserted += await persistAliases(db, 'organization', persistRows);
    } catch (err) {
      const msg = String(err);
      summary.organization.errors.push(msg.slice(0, 240));
      if (/usage limits|rate.?limit|quota/i.test(msg)) orgClaudeUsable = false;
    }
  }

  // ── CDC centers ──────────────────────────────────────────────────────
  // Center codes (NCHHSTP, NCEZID, NIOSH, …) are themselves the most
  // common alias users type, so we seed them deterministically alongside
  // the full center name. Claude then fills in any longhand aliases.
  const centers = await db.prepare(`
    SELECT DISTINCT center_code, center_name
    FROM   cdc_center
    WHERE  center_code IS NOT NULL AND TRIM(center_code) != ''
  `).all<CenterRow>();
  summary.center.entities = centers.results.length;
  // Seed: code itself is the alias for the center_name.
  const seededCenters = centers.results.map((c) => ({
    canonical_id:   c.center_code,
    canonical_name: c.center_name,
    aliases:        [c.center_code],
  }));
  summary.center.aliases_inserted += await persistAliases(db, 'center', seededCenters);
  // Claude pass for additional aliases.
  let centerClaudeUsable = true;
  for (const batch of chunk(centers.results, 50)) {
    if (!centerClaudeUsable) break;
    const prompt = batch.map((c) => `${c.center_code}: ${c.center_name}`).join('\n');
    try {
      const out = await aliasBatch(apiKey, prompt);
      const map = new Map(out.map((o) => [o.id, o.aliases]));
      const persistRows = batch.map((c) => ({
        canonical_id:   c.center_code,
        canonical_name: c.center_name,
        aliases:        map.get(c.center_code) ?? [],
      }));
      summary.center.aliases_inserted += await persistAliases(db, 'center', persistRows);
    } catch (err) {
      const msg = String(err);
      summary.center.errors.push(msg.slice(0, 240));
      if (/usage limits|rate.?limit|quota/i.test(msg)) centerClaudeUsable = false;
    }
  }

  return c.json({ ok: true, summary });
}
