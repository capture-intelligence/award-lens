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
- Always join organization ON organization.org_id = award.awarding_org_id to get agency names

NAME / TEXT MATCHES — always use LIKE with wildcards, never =:
The warehouse stores full legal names — e.g. "LANTANA CONSULTING GROUP",
"BOOZ ALLEN HAMILTON INC", "Centers for Disease Control and Prevention".
Users type fragments ("Lantana", "BAH", "CDC", "NCHHSTP"). Equality
comparisons miss every real match.
- Vendor:    WHERE v.legal_name      LIKE '%Lantana%'
- Agency:    WHERE o.canonical_name  LIKE '%NCHHSTP%'
- Center:    WHERE o.short_name      LIKE '%CDC%'
- NAICS desc: WHERE nc.description   LIKE '%software%'
- PSC desc:   WHERE pc.description   LIKE '%consulting%'
- Description: WHERE a.description   LIKE '%term%' OR a.description_long LIKE '%term%'
NEVER use canonical_name = 'X', legal_name = 'X', or short_name = 'X' for
user-supplied names. Use LIKE '%X%' even when the user types what looks
like an exact name. Codes (NAICS / PSC / federal account numbers) are
the only fields where = is correct.

QUESTION-SHAPE → QUERY-SHAPE:
- "Does X have any Y" / "Are there any X" / "Is there X" — return a SELECT
  with the actual rows (LIMIT 10), NOT COUNT/SUM. The user wants to see the
  contracts, not just a count. Include award_piid, description, vendor_name,
  current_value, pop_end_date so they can scan results.
- "How many X" / "Count of X" / "Total number of X" — return COUNT(*) or
  SUM(...) as an aggregate.
- "List X" / "Show me X" / "Top N X" — return SELECT rows with ORDER BY and
  LIMIT (default 50), not aggregates.
- "Total value of X" / "Sum of X" — return SUM(current_value) (genuine
  aggregate question).

CDC CENTER FILTERS — center codes (NCHHSTP, NCEZID, NIOSH, NCBDDD, NCIRD,
NCCDPHP, NCHS, NCEH, CSELS, ATSDR, …) are NOT organization rows. They live
in the cdc_center mapping table joined via award_federal_account. To filter
to a center, use:
  AND a.award_id IN (
    SELECT a2.award_id FROM award a2
    JOIN  cdc_center_override cco ON cco.award_piid = a2.award_piid
    WHERE cco.center_code = '<CODE>'
    UNION
    SELECT award_id FROM (
      SELECT afa.award_id, cc.center_code,
             ROW_NUMBER() OVER (PARTITION BY afa.award_id ORDER BY cc.priority ASC) AS rn
      FROM award_federal_account afa
      JOIN cdc_center cc ON cc.federal_account_code = afa.federal_account_code
    ) WHERE rn = 1 AND center_code = '<CODE>'
  )
NEVER filter centers via organization.canonical_name LIKE — center codes
do not appear there.

ACTIVE CONTRACT semantics:
- "Active" / "current" / "in-progress" → WHERE a.pop_end_date >= date('now')
  AND (a.pop_start_date IS NULL OR a.pop_start_date <= date('now'))
- NEVER use a.pop_end_date IS NULL for "active" — NULL means the date wasn't
  recorded, not that the contract is active.
- "Expired" → WHERE a.pop_end_date < date('now')

DO NOT INVENT FILTERS. The WHERE clause must contain ONLY filters that
correspond to nouns / qualifiers explicitly in the user's question.
- Don't add current_value > 0 unless the user mentions value / spend / amount.
- Don't add pop_start_date <= date('now') unless asked about "ongoing" /
  "started" — "active" only requires pop_end_date >= date('now').
- Don't add award_type / is_excluded / NAICS / PSC filters unless mentioned.

CONSISTENCY ACROSS PHRASINGS. The same WHERE clause must be generated
whether the user asks "how many X" (returns COUNT) or "show me all X"
(returns rows). Both phrasings describe the same set; only the
projection / LIMIT differ. If "How many active contracts does RTI have
with NCHHSTP?" gets a 3-clause WHERE, then "Show me all active contracts
RTI has with NCHHSTP" gets the SAME 3 clauses, plus LIMIT 50.`;

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

/**
 * Optional context M1 can use to ground its SQL:
 *   - scope:    the user's top-bar agency / center picker (their default
 *               filter unless they explicitly override in the question)
 *   - entities: pre-resolved name → canonical lookups from entity_alias
 *               (e.g. user typed "RTI" → canonical "RESEARCH TRIANGLE
 *               INSTITUTE", vendor_id=…)
 */
export interface M1Context {
  scope?:    { awarding_agency?: string; center_code?: string } | null;
  entities?: Array<{
    alias:          string;
    entity_kind:    'vendor' | 'organization' | 'center';
    canonical_id:   string | null;
    canonical_name: string;
  }> | null;
}

function buildUserMessage(question: string, ctx: M1Context | null | undefined): string {
  if (!ctx) return question;
  const lines: string[] = [];
  if (ctx.scope?.awarding_agency || ctx.scope?.center_code) {
    lines.push('USER SCOPE (the top-bar picker — apply unless the question explicitly contradicts it):');
    if (ctx.scope.awarding_agency) {
      lines.push(`  agency: organization.canonical_name LIKE '%${ctx.scope.awarding_agency.replace(/'/g, "''")}%'`);
    }
    if (ctx.scope.center_code) {
      lines.push(`  center: ${ctx.scope.center_code}  (use the cdc_center join pattern from the system rules)`);
    }
    lines.push('');
  }
  if (ctx.entities && ctx.entities.length > 0) {
    lines.push('RESOLVED ENTITIES (use these canonical values, not the user-typed alias):');
    for (const e of ctx.entities) {
      if (e.entity_kind === 'vendor') {
        lines.push(`  "${e.alias}" → vendor: legal_name="${e.canonical_name}" (vendor_id='${e.canonical_id}'). Prefer  v.vendor_id = '${e.canonical_id}'  or  v.legal_name LIKE '%${e.canonical_name.replace(/'/g, "''").split(' ')[0]}%'`);
      } else if (e.entity_kind === 'organization') {
        lines.push(`  "${e.alias}" → organization: canonical_name="${e.canonical_name}" (org_id='${e.canonical_id}'). Prefer  o.org_id = '${e.canonical_id}'  or  o.canonical_name LIKE '%${e.canonical_name.replace(/'/g, "''").split(' ')[0]}%'`);
      } else {
        lines.push(`  "${e.alias}" → CDC center: code="${e.canonical_id}" (name="${e.canonical_name}"). Apply via the cdc_center join pattern in the system rules with center_code='${e.canonical_id}'.`);
      }
    }
    lines.push('');
  }
  lines.push(`USER QUESTION: ${question}`);
  return lines.join('\n');
}

export async function callM1(
  question: string,
  ai: Ai,
  modalApiKey?: string,
  modalEndpoint?: string,
  context?: M1Context | null,
): Promise<M1Result> {
  const t0 = Date.now();
  const userMessage = buildUserMessage(question, context);
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
              { role: 'user',   content: userMessage },
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
          { role: 'user',   content: userMessage },
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
        { role: 'user',   content: userMessage },
      ],
      max_tokens: 400,
    } as Parameters<typeof ai.run>[1]);
    raw = (resp as { response?: string }).response ?? '';
  }

  const sql = extractSql(raw);
  assertReadOnly(sql);
  return { sql, promptTokens: 0, outputTokens: 0, durationMs: Date.now() - t0 };
}
