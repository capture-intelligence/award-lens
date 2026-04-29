/**
 * Adapter: award rows → DataCoverageTree hierarchy.
 *
 *   CDC (root)
 *     └─ Federal account (e.g., NCHHSTP — 075-0950)
 *         └─ Program activity (e.g., HIV/AIDS, Viral Hepatitis…)
 *             └─ Contract (leaf)
 *
 * Rows lacking a federal_account placement land under "Unclassified". This
 * happens for awards that haven't been enriched yet by the per-award detail
 * sweep — the Tree tab shows them so users know they exist, with the right
 * urgency colour and a tooltip pointing at the sidecar enrichment step.
 *
 * Coloring of leaves uses the contract-end-date proximity:
 *   restricted (vermilion) — < 30 days remaining or already expired
 *   both       (rust)      — 30–180 days remaining
 *   public     (sage)      — > 180 days remaining
 *
 * Inner nodes carry `category: 'group'` so the component renders them with
 * the category swatch rather than a leaf-style availability colour.
 */
import type { DataElement } from './DataCoverageTree';

const fmtMoneyShort = (n: number): string => {
  if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
  if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
  if (Math.abs(n) >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
  return '$' + Math.round(n).toLocaleString();
};

function urgency(days: number | null | undefined): 'restricted' | 'both' | 'public' {
  if (days == null || !Number.isFinite(days)) return 'public';
  if (days < 30)  return 'restricted';
  if (days < 180) return 'both';
  return 'public';
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

interface BuildOptions {
  rootTitle?: string;     // defaults to "CDC"
  rootSubtitle?: string;  // optional small text below the root for context
}

/**
 * Splits the GROUP_CONCAT(... '|') strings produced by the /explore worker
 * into parallel arrays of (account_code, account_name, pa_code, pa_name).
 * Empty / missing values become null so the caller can spot unenriched rows.
 */
function splitFundingTuples(row: Record<string, unknown>): Array<{
  account_code: string;
  account_name: string | null;
  pa_code: string | null;
  pa_name: string | null;
}> {
  const acCodes  = String(row.federal_account_codes ?? '').split('|').filter(Boolean);
  const acNames  = String(row.federal_account_names ?? '').split('|');
  const paCodes  = String(row.program_activity_codes ?? '').split('|');
  const paNames  = String(row.program_activity_names ?? '').split('|');
  return acCodes.map((c, i) => ({
    account_code: c,
    account_name: acNames[i] && acNames[i].length ? acNames[i] : null,
    pa_code:      paCodes[i] && paCodes[i].length ? paCodes[i] : null,
    pa_name:      paNames[i] && paNames[i].length ? paNames[i] : null,
  }));
}

// Concise leaf label — money up front, then the first ≤3 words of the
// contract description so the eye reads "what it's worth, what it is" at
// a glance. Falls back to PIID when the description is empty (rare), and
// to a placeholder when both are missing.
function leafTitle(row: Record<string, unknown>): string {
  const money = fmtMoneyShort(Number(row.current_value ?? 0));
  const desc  = String(row.description ?? '').trim();
  const words = desc.split(/\s+/).filter(Boolean).slice(0, 3);
  let namePart: string;
  if (words.length > 0) {
    namePart = words.join(' ');
  } else {
    const piid = String(row.award_piid ?? '').trim();
    namePart = piid || '(unnamed)';
  }
  return `${money} - ${namePart}`;
}

export function buildSpendTree(
  rows: Record<string, unknown>[],
  opts: BuildOptions = {},
): DataElement {
  const rootTitle = opts.rootTitle ?? 'CDC';

  // Two-tier accumulator: CENTER → activity → leaves[]
  // Grouping by center_code (already attached by the worker's decorate())
  // gives stable, short branch labels — NCHHSTP / NCEZID / etc. — and
  // sidesteps the GROUP_CONCAT-order issue that produced multiple branches
  // with the same long federal-account name.
  type LeafBucket = { leaves: DataElement[]; total: number; pa_name: string | null };
  type CenterBucket = {
    code: string;          // e.g., "NCHHSTP"
    name: string;          // e.g., "National Center for HIV..."
    activities: Map<string, LeafBucket>;
    total: number;
    count: number;
    accountCodes: Set<string>;  // unique federal accounts seen for this center
  };
  const centers = new Map<string, CenterBucket>();

  const UNCLASSIFIED_KEY = 'UNKNOWN';

  let grandTotal = 0;
  let grandCount = 0;

  for (const row of rows) {
    const value = Number(row.current_value ?? 0);
    grandTotal += value;
    grandCount += 1;

    const centerCode = String(row.center_code ?? UNCLASSIFIED_KEY) || UNCLASSIFIED_KEY;
    const centerName = String(row.center_name ?? centerCode);

    const tuples = splitFundingTuples(row);
    // Pick the program activity from whichever tuple matches the row's
    // resolved center (so PA labels actually align with the center bucket).
    // Fall back to the first tuple's PA when no obvious match.
    const primary = tuples[0] ?? null;

    let center = centers.get(centerCode);
    if (!center) {
      center = {
        code: centerCode,
        name: centerName,
        activities: new Map(),
        total: 0,
        count: 0,
        accountCodes: new Set(),
      };
      centers.set(centerCode, center);
    }
    center.total += value;
    center.count += 1;
    for (const t of tuples) center.accountCodes.add(t.account_code);

    // Dedupe siblings by NAME (lowercased trim). The funding-tuple primary
    // can vary per row when GROUP_CONCAT order differs across awards funded
    // from multiple accounts, which previously produced two visually
    // identical PA branches under the same center. Keying on the visible
    // label collapses them into one.
    const paName = primary?.pa_name?.trim() ?? '';
    const paCode = primary?.pa_code?.trim() ?? '';
    const paKey = paName ? paName.toLowerCase() : (paCode || '__no_activity__');
    let bucket = center.activities.get(paKey);
    if (!bucket) {
      bucket = { leaves: [], total: 0, pa_name: paName || (paCode ? `Program activity ${paCode}` : null) };
      center.activities.set(paKey, bucket);
    }
    bucket.total += value;

    const days       = Number(row.days_to_contract_end);
    const piid       = String(row.award_piid ?? '').trim();
    const vendor     = String(row.vendor_name ?? '—');
    const description= String(row.description ?? '(no description)').trim();
    const popEnd     = String(row.pop_end_date ?? '').slice(0, 10);
    const naicsDesc  = String(row.naics_description ?? '').trim();

    const dayChip = (() => {
      if (!Number.isFinite(days)) return '';
      if (days < 0)  return `<span class="pill" style="background:rgba(230,72,51,0.15);color:#E64833">${Math.abs(days)}d ago</span>`;
      if (days < 30) return `<span class="pill" style="background:rgba(230,72,51,0.15);color:#E64833">${days}d left</span>`;
      if (days < 180) return `<span class="pill" style="background:rgba(135,79,65,0.15);color:#874F41">${days}d left</span>`;
      return `<span class="pill" style="background:rgba(144,174,173,0.25);color:#244855">${days}d</span>`;
    })();

    // Show all funding accounts on the tooltip if there are multiple.
    const multiAccountChip = tuples.length > 1
      ? `<div style="margin-top:4px"><span class="strong">Funded from ${tuples.length} accounts:</span> ` +
        tuples.map((t) => `<span class="pill">${escapeHtml(t.account_code)}</span>`).join(' ') +
        '</div>'
      : '';

    const leaf: DataElement = {
      title: leafTitle(row),
      availability: urgency(days),
      description: `${fmtMoneyShort(value)} · ${vendor.length > 28 ? vendor.slice(0, 25) + '…' : vendor}`,
      htmlDescription:
        `<div><span class="strong">${fmtMoneyShort(value)}</span> · ` +
        `<span class="pill">${escapeHtml(piid || '—')}</span></div>` +
        `<div style="margin-top:4px"><span class="strong">Vendor:</span> ${escapeHtml(vendor)}</div>` +
        (popEnd ? `<div style="margin-top:2px"><span class="strong">Ends:</span> ${escapeHtml(popEnd)} ${dayChip}</div>` : '') +
        (naicsDesc ? `<div style="margin-top:2px;font-size:11px;opacity:.85"><span class="strong">NAICS:</span> ${escapeHtml(naicsDesc)}</div>` : '') +
        multiAccountChip,
      details: description.length > 220 ? description.slice(0, 217) + '…' : description,
      payload: row,
    };
    bucket.leaves.push(leaf);
  }

  // Convert maps → DataElement nodes, sorted by total $ descending at each tier.
  const centerNodes: DataElement[] = Array.from(centers.values())
    .sort((a, b) => b.total - a.total)
    .map((center) => {
      const activityNodes: DataElement[] = Array.from(center.activities.entries())
        .sort((a, b) => b[1].total - a[1].total)
        .map(([paKey, bucket]) => ({
          title: bucket.pa_name ?? (paKey === '__no_activity__' ? '(no program activity)' : paKey),
          category: 'group',
          description: `${fmtMoneyShort(bucket.total)} · ${bucket.leaves.length} contract${bucket.leaves.length === 1 ? '' : 's'}`,
          htmlDescription:
            `<div><span class="strong">${fmtMoneyShort(bucket.total)}</span> across ${bucket.leaves.length} contract${bucket.leaves.length === 1 ? '' : 's'}</div>` +
            (paKey !== '__no_activity__' ? `<div style="margin-top:4px"><span class="pill">PA ${escapeHtml(paKey)}</span></div>` : ''),
          children: bucket.leaves.sort((a, b) => {
            const av = (a.payload as Record<string, unknown> | undefined)?.current_value ?? 0;
            const bv = (b.payload as Record<string, unknown> | undefined)?.current_value ?? 0;
            return Number(bv) - Number(av);
          }),
        }));

      const accountList = Array.from(center.accountCodes).filter(Boolean).sort();

      return {
        // Short label — center code (NCHHSTP / NCEZID / …). Long centre name
        // moves into the tooltip so the canvas stays compact.
        title: center.code,
        category: 'group',
        description: `${fmtMoneyShort(center.total)} · ${center.count} contract${center.count === 1 ? '' : 's'}`,
        htmlDescription:
          `<div class="strong">${escapeHtml(center.name)}</div>` +
          `<div style="margin-top:4px"><span class="strong">${fmtMoneyShort(center.total)}</span> across ${center.count} contract${center.count === 1 ? '' : 's'}</div>` +
          (accountList.length > 0
            ? `<div style="margin-top:4px">Funding: ${accountList.map((c) => `<span class="pill">${escapeHtml(c)}</span>`).join(' ')}</div>`
            : (center.code === UNCLASSIFIED_KEY
                ? '<div style="margin-top:4px;font-style:italic">Run the per-award enrichment to place these contracts under their actual center.</div>'
                : '')),
        children: activityNodes,
      };
    });

  return {
    title: rootTitle,
    description: `${fmtMoneyShort(grandTotal)} · ${grandCount} contract${grandCount === 1 ? '' : 's'}`,
    htmlDescription:
      `<div><span class="strong">${fmtMoneyShort(grandTotal)}</span> across ${grandCount} contract${grandCount === 1 ? '' : 's'}</div>` +
      `<div style="margin-top:4px">${centers.size} center${centers.size === 1 ? '' : 's'} represented</div>` +
      (opts.rootSubtitle ? `<div style="margin-top:4px;font-style:italic;opacity:.8">${escapeHtml(opts.rootSubtitle)}</div>` : ''),
    children: centerNodes,
  };
}
