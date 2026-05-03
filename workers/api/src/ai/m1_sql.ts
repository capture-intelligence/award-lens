/**
 * M1 — SQL specialist.
 * Calls Fireworks AI serverless with the awards-sql-lora adapter.
 * Returns a SELECT-only SQL string, or throws on safety violation / API error.
 */

// Compact schema string — embedded at build time (< 2KB, changes rarely).
const SCHEMA = `app_user(user_id:TXT, email:TXT, display_name:TXT, avatar_url:TXT, provider:TXT, provider_sub:TXT, role:TXT, approved_by:TXT→app_user, approved_at:TXT, rejected_at:TXT, last_login_at:TXT, created_at:TXT, updated_at:TXT)
award(award_id:TXT, award_piid:TXT, parent_piid:TXT, award_type:TXT, vendor_id:TXT→vendor, awarding_org_id:TXT→organization, funding_org_id:TXT→organization, awarding_office_id:TXT→contracting_office, funding_office_id:TXT→contracting_office, naics_code:TXT→naics_code, psc_code:TXT→psc_code, description:TXT, base_value:REAL, current_value:REAL, obligated_amount:REAL, currency_code:TXT, pop_start_date:TXT, pop_end_date:TXT, solicitation_id:TXT, source_last_modified:TXT, created_at:TXT, updated_at:TXT, description_long:TXT, mod_history:TXT, description_enriched_at:INT)
award_federal_account(award_id:TXT→award, federal_account_code:TXT, federal_account_name:TXT, program_activity_code:TXT, program_activity_name:TXT)
award_modification(mod_id:TXT, award_id:TXT→award, mod_number:TXT, action_date:TXT, action_type:TXT, obligation_delta:REAL, new_total_value:REAL, reason_code:TXT, source_id:TXT, source_tx_id:TXT)
award_performance_location(award_id:TXT→award, country_code:TXT, state:TXT, city:TXT, zip:TXT, congressional_district:TXT)
cdc_center(federal_account_code:TXT, center_code:TXT, center_name:TXT, priority:INT)
contracting_office(office_id:TXT, org_id:TXT→organization, fpds_office_code:TXT, name:TXT)
grant_opportunity(opportunity_id:TXT, opportunity_number:TXT, title:TXT, agency_code:TXT, agency_name:TXT, category:TXT, funding_instrument:TXT, assistance_listings:TXT, posted_date:TXT, close_date:TXT, archive_date:TXT, est_total_funding:REAL, award_ceiling:REAL, award_floor:REAL, expected_awards:INT, eligibility_codes:TXT, description:TXT, status:TXT, opportunity_url:TXT, doc_type:TXT, extract_date:TXT, created_at:TXT, updated_at:TXT)
ingestion_run(run_id:INT, source_id:TXT, started_at:TXT, finished_at:TXT, status:TXT, watermark_before:TXT, watermark_after:TXT, rows_fetched:INT, rows_upserted:INT, rows_failed:INT, error_summary:TXT, workflow_instance_id:TXT)
naics_code(naics_code:TXT, description:TXT, year_edition:INT)
organization(org_id:TXT, parent_org_id:TXT→organization, org_type:TXT, canonical_name:TXT, short_name:TXT, acronym:TXT, country_code:TXT, external_ids_json:TXT, is_stub:INT, created_at:TXT, updated_at:TXT)
psc_code(psc_code:TXT, description:TXT, category:TXT)
sam_exclusion(exclusion_id:TXT, uei:TXT, duns:TXT, cage_code:TXT, legal_name:TXT, exclusion_type:TXT, is_active:INT, active_date:TXT, termination_date:TXT, excluding_agency:TXT, reason:TXT, country_code:TXT, state:TXT, city:TXT)
solicitation(solicitation_id:TXT, sol_number:TXT, notice_type:TXT, title:TXT, posted_date:TXT, response_deadline:TXT, agency:TXT, sub_agency:TXT, naics_codes:TXT, psc_codes:TXT, set_aside:TXT, description:TXT, link:TXT)
vendor(vendor_id:TXT, uei:TXT, duns:TXT, cage_code:TXT, legal_name:TXT, common_name:TXT, country_code:TXT, state:TXT, city:TXT, primary_naics:TXT→naics_code, parent_vendor_id:TXT→vendor, business_types:TXT, sam_status:TXT)`;

const SYSTEM = `You are a text-to-SQL model for a SQLite database of federal contracts and grants.
Given a question, return ONLY the SQL query. Do not include explanation or fences — just SQL ending with semicolon.

SCHEMA:
${SCHEMA}

RULES:
- award.naics_code is a TEXT column (e.g. '541512'). To filter by NAICS use: WHERE a.naics_code = '541512' or JOIN naics_code nc ON nc.naics_code = a.naics_code
- For "expiring in the next N months": WHERE pop_end_date BETWEEN date('now') AND date('now', '+N months')
- For "expiring in the next N days":   WHERE pop_end_date BETWEEN date('now') AND date('now', '+N days')
- Never use date('now', '-N months') as a start bound for future expiry queries
- For "similar to X": use WHERE description LIKE '%X%' OR description_long LIKE '%X%'
- Always join vendor ON vendor.vendor_id = award.vendor_id to get vendor names
- Always join organization ON organization.org_id = award.awarding_org_id to get agency names`;

export const M1_MODEL_ID = 'algocrat/awards-sql-lora';

/** Reject any SQL that isn't a pure SELECT or WITH…SELECT. */
function assertReadOnly(sql: string): void {
  const s = sql.trim().toUpperCase();
  if (!s.startsWith('SELECT') && !s.startsWith('WITH')) {
    throw new Error(`M1 SQL safety: expected SELECT/WITH, got: ${sql.slice(0, 80)}`);
  }
  // Block write keywords anywhere in the statement
  if (/\b(INSERT|UPDATE|DELETE|DROP|CREATE|ALTER|ATTACH|PRAGMA)\b/.test(s)) {
    throw new Error(`M1 SQL safety: write keyword detected: ${sql.slice(0, 80)}`);
  }
}

/** Extract the first SQL statement ending in ; from model output. */
function extractSql(text: string): string {
  // Strip markdown fences if present
  const fenced = text.match(/```(?:sql)?\s*([\s\S]*?)```/i);
  if (fenced) return fenced[1].trim();
  // Take up to the first semicolon
  const m = text.match(/\s*([\s\S]*?;)/);
  if (m) return m[1].trim();
  return text.trim();
}

export interface M1Result {
  sql: string;
  promptTokens: number;
  outputTokens: number;
  durationMs: number;
}

export async function callM1(
  question: string,
  ai: Ai,
  modalApiKey?: string,
  modalEndpoint?: string,
): Promise<M1Result> {
  const t0 = Date.now();
  let raw: string;

  if (modalApiKey && modalEndpoint) {
    // Fine-tuned path: Modal Serverless with M1 LoRA adapter (25s timeout, falls back to Workers AI)
    try {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), 25000);
      let resp: Response;
      try {
        resp = await fetch(modalEndpoint, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            adapter: 'm1',
            api_key: modalApiKey,
            messages: [
              { role: 'system', content: SYSTEM },
              { role: 'user',   content: question },
            ],
            max_tokens: 400,
            temperature: 0.0,
          }),
          signal: controller.signal,
        });
      } finally {
        clearTimeout(timer);
      }
      if (!resp.ok) throw new Error(`Modal M1 error ${resp.status}: ${(await resp.text()).slice(0, 200)}`);
      const data = await resp.json() as { output?: { text?: string }; error?: string };
      if (data.error) throw new Error(`Modal M1 job error: ${data.error}`);
      raw = data.output?.text ?? '';
    } catch {
      // Modal unavailable or cold-starting — fall through to Workers AI
      const resp = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
        messages: [
          { role: 'system', content: SYSTEM },
          { role: 'user',   content: question },
        ],
        max_tokens: 400,
      } as Parameters<typeof ai.run>[1]);
      raw = (resp as { response?: string }).response ?? '';
    }
  } else {
    // Fallback: Workers AI base model
    const resp = await ai.run('@cf/meta/llama-3.1-8b-instruct', {
      messages: [
        { role: 'system', content: SYSTEM },
        { role: 'user',   content: question },
      ],
      max_tokens: 400,
    } as Parameters<typeof ai.run>[1]);
    raw = (resp as { response?: string }).response ?? '';
  }

  const sql = extractSql(raw);
  assertReadOnly(sql);
  return { sql, promptTokens: 0, outputTokens: 0, durationMs: Date.now() - t0 };
}
