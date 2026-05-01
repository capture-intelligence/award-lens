#!/usr/bin/env node
// =============================================================================
// SAM.gov Opportunities sync (sidecar) — pre-award contract intelligence
//
// Pulls https://api.sam.gov/opportunities/v2/search filtered to CDC by
// default and pages through results, posting batches to the api-worker.
//
// Two batches per run:
//   - solicitations (POST /sidecar/solicitations/upsert)
//   - attachments   (POST /sidecar/solicitations/attachments/upsert)
//
// Phase 3a (separate, not here) downloads the attachment PDFs into R2.
//
// Env (loaded by systemd EnvironmentFile):
//   API_BASE         required
//   INGEST_TOKEN     required
//   SAM_API_KEY      required
//   SAM_OPPS_AGENCY  optional — default "075" (HHS, includes CDC). Use ""
//                    to pull all agencies.
//   SAM_OPPS_DAYS    optional — lookback window, default 30 (days)
//   SAM_OPPS_PAGES   optional — hard cap, default 50 (× 100 = 5000 rows max)
//   PAGE_SIZE        optional — default 100, max 1000
//   PACE_MS          optional — between pages, default 1500
// =============================================================================

const env = process.env;
const require_env = (k) => {
  if (!env[k]) { console.error(`ERROR: env var ${k} required`); process.exit(1); }
  return env[k];
};

const API   = require_env('API_BASE').replace(/\/$/, '');
const TOKEN = require_env('INGEST_TOKEN');
const KEY   = require_env('SAM_API_KEY');

const AGENCY     = env.SAM_OPPS_AGENCY ?? '075';
const DAYS_BACK  = Number(env.SAM_OPPS_DAYS  ?? 30);
const MAX_PAGES  = Number(env.SAM_OPPS_PAGES ?? 50);
const PAGE_SIZE  = Math.min(Number(env.PAGE_SIZE ?? 100), 1000);
const PACE_MS    = Number(env.PACE_MS ?? 1500);

const SAM_BASE = 'https://api.sam.gov/opportunities/v2/search';

const log = (level, msg, extra = {}) =>
  console.log(JSON.stringify({ ts: new Date().toISOString(), level, msg, ...extra }));

// Format dates as MM/DD/YYYY which is what SAM expects for postedFrom/To
function mmddyyyy(d) {
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${mm}/${dd}/${d.getFullYear()}`;
}

async function fetchPage(offset, attempt = 1) {
  const today = new Date();
  const since = new Date(today.getTime() - DAYS_BACK * 86_400_000);
  const url = new URL(SAM_BASE);
  url.searchParams.set('api_key', KEY);
  url.searchParams.set('limit',   String(PAGE_SIZE));
  url.searchParams.set('offset',  String(offset));
  url.searchParams.set('postedFrom', mmddyyyy(since));
  url.searchParams.set('postedTo',   mmddyyyy(today));
  if (AGENCY) url.searchParams.set('ncode', AGENCY);

  let status = 0;
  try {
    const r = await fetch(url, {
      headers: { Accept: '*/*' },                  // SAM rejects application/json
      signal:  AbortSignal.timeout(60_000),
    });
    status = r.status;
    if (r.status === 429) {
      const text = await r.text();
      let parsed = null; try { parsed = JSON.parse(text); } catch { /* not JSON */ }
      if (parsed?.code === '900804' || /quota/i.test(parsed?.message ?? '')) {
        const e = new Error(`SAM Opps quota exhausted${parsed?.nextAccessTime ? ` (resets ${parsed.nextAccessTime})` : ''}`);
        e.quotaExhausted = true;
        throw e;
      }
      throw new Error(`SAM Opps transient 429`);
    }
    if (r.status >= 500) throw new Error(`SAM Opps transient ${r.status}`);
    if (!r.ok) {
      const body = await r.text();
      throw new Error(`SAM Opps ${r.status}: ${body.slice(0, 300)}`);
    }
    return r.json();
  } catch (err) {
    if (err && err.quotaExhausted) throw err;
    if (attempt >= 5) throw err;
    const base = status === 429 ? 30_000 : 2_000;
    const delay = Math.min(base * Math.pow(2, attempt - 1), 240_000);
    log('warn', 'fetchPage retry', { offset, attempt, status, delay_ms: delay, error: String(err).slice(0, 200) });
    await new Promise((r) => setTimeout(r, delay));
    return fetchPage(offset, attempt + 1);
  }
}

// SAM Opps payload reference (single opportunitiesData element):
//   {
//     noticeId, solicitationNumber, fullParentPathName, fullParentPathCode,
//     title, postedDate, type, baseType, archiveType, archiveDate,
//     typeOfSetAsideDescription, typeOfSetAside, responseDeadLine,
//     naicsCode, classificationCode (psc),
//     active, award, organizationType,
//     placeOfPerformance: { country: { code }, state: { code }, city: { code, name }, zip },
//     description (URL pointing to plain text), uiLink,
//     resourceLinks: [ { fileName, url, mimeType, fileSize, attachmentId, ... } ]
//   }
function mapSolicitation(raw) {
  const pop = raw?.placeOfPerformance ?? {};
  // fullParentPathName is "DEPT OF HEALTH AND HUMAN SERVICES.CENTERS FOR DISEASE CONTROL AND PREVENTION.OFFICE OF ACQUISITION SERVICES"
  // — split into agency / sub_agency / office.
  const path = String(raw?.fullParentPathName ?? '').split('.').map((s) => s.trim()).filter(Boolean);
  const agency    = path[0] ?? null;
  const subAgency = path[1] ?? null;
  const office    = path[2] ?? null;

  return {
    solicitation_id:  raw?.noticeId ?? null,
    sol_number:       raw?.solicitationNumber ?? null,
    notice_type:      raw?.type ?? raw?.baseType ?? '(unknown)',
    title:            raw?.title ?? '(untitled)',
    posted_date:      raw?.postedDate ?? null,
    response_deadline: raw?.responseDeadLine ? String(raw.responseDeadLine).slice(0, 10) : null,
    archive_date:     raw?.archiveDate ?? null,
    agency, sub_agency: subAgency, office,
    naics_codes:      raw?.naicsCode ? String(raw.naicsCode) : null,
    psc_codes:        raw?.classificationCode ? String(raw.classificationCode) : null,
    set_aside:        raw?.typeOfSetAsideDescription ?? null,
    set_aside_code:   raw?.typeOfSetAside ?? null,
    pop_country:      pop?.country?.code ?? null,
    pop_state:        pop?.state?.code   ?? null,
    pop_city:         pop?.city?.name    ?? null,
    pop_zip:          pop?.zip           ?? null,
    description:      raw?.description ?? null,    // SAM returns a URL not text; left as-is for now
    link:             raw?.uiLink ?? null,
    raw_json:         JSON.stringify(raw),
  };
}

function mapAttachments(raw) {
  const links = Array.isArray(raw?.resourceLinks) ? raw.resourceLinks : [];
  const solId = raw?.noticeId;
  if (!solId) return [];
  return links
    .filter((a) => a?.attachmentId || a?.url)
    .map((a) => ({
      attachment_id:   a?.attachmentId ?? `${solId}:${a?.url ?? a?.fileName ?? Math.random()}`,
      solicitation_id: solId,
      file_name:       a?.fileName ?? null,
      file_url:        a?.url ?? null,
      file_type:       (a?.mimeType ?? '').toLowerCase().includes('pdf') ? 'PDF'
                       : (a?.mimeType ?? '').toLowerCase().includes('zip') ? 'ZIP'
                       : 'OTHER',
      content_type:    a?.mimeType ?? null,
      size_bytes:      a?.fileSize ?? null,
    }));
}

async function postBatch(path, key, rows) {
  const r = await fetch(`${API}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify({ [key]: rows }),
  });
  if (!r.ok) throw new Error(`${path} ${r.status}: ${(await r.text()).slice(0, 300)}`);
  return r.json();
}

(async () => {
  log('info', 'sync-sam-opportunities start', {
    api: API, sam: SAM_BASE, agency: AGENCY, days: DAYS_BACK,
    max_pages: MAX_PAGES, page_size: PAGE_SIZE,
  });

  let totalSols = 0, totalAtts = 0, totalApplied = 0;
  let offset = 0;

  try {
    for (let page = 0; page < MAX_PAGES; page++) {
      const t0 = Date.now();
      const data = await fetchPage(offset);
      const list = data?.opportunitiesData ?? [];
      if (!Array.isArray(list) || list.length === 0) {
        log('info', 'page empty — stopping', { page, offset });
        break;
      }

      const solicitations = [];
      const attachments   = [];
      for (const raw of list) {
        const s = mapSolicitation(raw);
        if (!s.solicitation_id) continue;
        solicitations.push(s);
        attachments.push(...mapAttachments(raw));
      }

      const solReply = await postBatch('/sidecar/solicitations/upsert', 'solicitations', solicitations);
      let attReply = { accepted: 0, applied: 0 };
      if (attachments.length > 0) {
        attReply = await postBatch('/sidecar/solicitations/attachments/upsert', 'attachments', attachments);
      }

      totalSols    += solReply?.accepted ?? 0;
      totalAtts    += attReply?.accepted ?? 0;
      totalApplied += solReply?.applied  ?? 0;

      log('info', 'page processed', {
        page, offset, count: list.length,
        sol_accepted: solReply?.accepted, sol_applied: solReply?.applied,
        att_accepted: attReply?.accepted, att_applied: attReply?.applied,
        ms: Date.now() - t0,
        total_records: data?.totalRecords ?? null,
      });

      offset += list.length;
      if (list.length < PAGE_SIZE) break;
      await new Promise((r) => setTimeout(r, PACE_MS));
    }
  } catch (err) {
    log('error', 'sync failed', { error: String(err).slice(0, 300) });
    process.exit(1);
  }

  log('info', 'sync-sam-opportunities complete', {
    solicitations_accepted: totalSols,
    solicitations_applied:  totalApplied,
    attachments_accepted:   totalAtts,
  });
})();
