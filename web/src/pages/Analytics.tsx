import * as React from 'react';
// @ts-expect-error — react-pivottable ships its own types only sometimes; the
// PivotTableUI export is a default React class.
import PivotTableUI from 'react-pivottable/PivotTableUI';
// @ts-expect-error — same as above
import TableRenderers from 'react-pivottable/TableRenderers';
import 'react-pivottable/pivottable.css';
import { motion } from 'framer-motion';
import { RefreshCw, Download, Search, X, Eye } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { useViewQuery, useViews } from '@/lib/view-context';
import { NoViewSelected } from '@/components/ui/NoViewSelected';
import { fmtInt, fmtMoney, fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AwardDetail } from '@/components/AwardDetail';
import { natureOfWork } from '@/lib/nature-of-work';

// ─── Field display map (snake_case → friendly caption) ───────────────────────

const COLUMNS: Array<{ key: string; caption: string }> = [
  { key: 'award_piid',          caption: 'PIID' },
  { key: 'parent_piid',         caption: 'Parent PIID' },
  { key: 'award_id',            caption: 'Internal ID' },
  { key: 'solicitation_id',     caption: 'Solicitation' },
  { key: 'award_type',          caption: 'Type' },
  { key: 'description',         caption: 'Description' },
  { key: 'current_value',       caption: 'Current value' },
  { key: 'obligated_amount',    caption: 'Obligated' },
  { key: 'base_value',          caption: 'Base value' },
  { key: 'currency_code',       caption: 'Currency' },
  { key: 'pop_start_date',      caption: 'PoP start' },
  { key: 'pop_end_date',        caption: 'Contract end' },
  { key: 'source_last_modified',caption: 'Last modified' },
  { key: 'days_to_contract_end',caption: 'Days to end' },
  { key: 'vendor_name',         caption: 'Vendor' },
  { key: 'vendor_uei',          caption: 'Vendor UEI' },
  { key: 'vendor_state',        caption: 'Vendor state' },
  { key: 'vendor_city',         caption: 'Vendor city' },
  { key: 'vendor_country',      caption: 'Vendor country' },
  { key: 'vendor_zip',          caption: 'Vendor zip' },
  { key: 'awarding_agency',     caption: 'Awarding agency' },
  { key: 'awarding_department', caption: 'Awarding dept.' },
  { key: 'naics_code',          caption: 'NAICS' },
  { key: 'naics_description',   caption: 'NAICS description' },
  { key: 'psc_code',            caption: 'PSC' },
  { key: 'psc_description',     caption: 'PSC description' },
  { key: 'pop_country',         caption: 'PoP country' },
  { key: 'pop_state',           caption: 'PoP state' },
  { key: 'pop_city',            caption: 'PoP city' },
  { key: 'pop_district',        caption: 'PoP district' },
  { key: 'is_excluded',         caption: 'Excluded?' },
];
// Pre-flatten each award row into a friendlier shape that the pivot table
// will display with human-readable column names. The original snake_case
// row stays attached under `__raw` so we can pass it to the detail panel.
function transformForPivot(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const col of COLUMNS) {
      let v = row[col.key];
      if (col.key === 'is_excluded') v = Number(v) === 1 ? 'Yes' : 'No';
      out[col.caption] = v ?? '';
    }
    out['Nature of work'] = natureOfWork({
      description:        (row.description       ?? '') as string,
      psc_description:    (row.psc_description   ?? '') as string,
      psc_code:           (row.psc_code          ?? '') as string,
      naics_description:  (row.naics_description ?? '') as string,
      naics_code:         (row.naics_code        ?? '') as string,
    });
    out.__raw = row; // not visible in pivot — used for detail click-through
    return out;
  });
}

// Default starting pivot: agency × nature of work, summing current value
const DEFAULT_PIVOT_STATE = {
  rows: ['Awarding agency'],
  cols: ['Nature of work'],
  vals: ['Current value'],
  aggregatorName: 'Sum',
  rendererName: 'Table',
  // Hide noisy fields from the pivot's drag-source list — users can still
  // select them from the dropdown if they want.
  hiddenFromAggregators: ['__raw'],
  hiddenAttributes: ['__raw'],
};

// ─── Export helpers (CSV / TSV / JSON) ───────────────────────────────────────

function csvCell(v: unknown): string {
  if (v === null || v === undefined) return '';
  const s = String(v);
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
function downloadBlob(blob: Blob, name: string) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = name;
  document.body.appendChild(a); a.click(); document.body.removeChild(a);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
function safeFilename(name: string, ext: string): string {
  const stem = name.replace(/[^a-z0-9]+/gi, '_').replace(/^_+|_+$/g, '').toLowerCase() || 'awardlens';
  return `${stem}_${new Date().toISOString().slice(0, 10)}.${ext}`;
}
function exportCsv(rows: Record<string, unknown>[], viewName: string) {
  if (!rows.length) return;
  const cols = [...COLUMNS.map((c) => c.key), 'nature_of_work'];
  const headers = [...COLUMNS.map((c) => c.caption), 'Nature of work'];
  const lines = [headers.map(csvCell).join(',')];
  for (const r of rows) {
    const nature = natureOfWork(r as any);
    lines.push([
      ...cols.slice(0, -1).map((k) => csvCell(r[k])),
      csvCell(nature),
    ].join(','));
  }
  downloadBlob(
    new Blob(['﻿' + lines.join('\r\n')], { type: 'text/csv;charset=utf-8' }),
    safeFilename(viewName, 'csv'),
  );
}
function exportTsv(rows: Record<string, unknown>[], viewName: string) {
  if (!rows.length) return;
  const cols = [...COLUMNS.map((c) => c.key), 'nature_of_work'];
  const headers = [...COLUMNS.map((c) => c.caption), 'Nature of work'];
  const tsv = (v: unknown) => (v == null ? '' : String(v).replace(/[\t\n\r]/g, ' '));
  const lines = [headers.map(tsv).join('\t')];
  for (const r of rows) {
    const nature = natureOfWork(r as any);
    lines.push([
      ...cols.slice(0, -1).map((k) => tsv(r[k])),
      tsv(nature),
    ].join('\t'));
  }
  downloadBlob(
    new Blob(['﻿' + lines.join('\r\n')], { type: 'text/tab-separated-values;charset=utf-8' }),
    safeFilename(viewName, 'tsv'),
  );
}
function exportJson(rows: Record<string, unknown>[], viewName: string) {
  const enriched = rows.map((r) => ({ ...r, nature_of_work: natureOfWork(r as any) }));
  downloadBlob(
    new Blob([JSON.stringify(enriched, null, 2)], { type: 'application/json' }),
    safeFilename(viewName, 'json'),
  );
}

// ─── Page ────────────────────────────────────────────────────────────────────

interface ExploreResponse {
  view_id: string;
  view_name: string;
  count: number;
  results: Record<string, unknown>[];
}

export function AnalyticsPage() {
  const viewQuery = useViewQuery();
  const { active, loading: viewsLoading } = useViews();
  const [data,  setData]  = React.useState<ExploreResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [pivotState, setPivotState] = React.useState<any>(DEFAULT_PIVOT_STATE);
  const [selectedAward, setSelectedAward] = React.useState<Record<string, unknown> | null>(null);

  React.useEffect(() => {
    if (viewsLoading || !active) return;
    let alive = true;
    setData(null); setError(null);
    (async () => {
      try {
        const r = await api.get<ExploreResponse>('/explore', viewQuery);
        if (alive) setData(r);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [viewsLoading, active, viewQuery?.view_id, reloadToken]);

  const pivotData = React.useMemo(
    () => (data ? transformForPivot(data.results) : []),
    [data],
  );

  if (!viewsLoading && !active) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Analytics"
          description="Pivot grid + click-through detail across the active view."
        />
        <NoViewSelected pageLabel="data" />
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow="Explore"
        title="Analytics"
        description={
          data
            ? `${fmtInt(data.count)} awards in "${data.view_name}". Drag fields between Rows / Columns / Values, or click a row in the browser below for full detail.`
            : 'Pivot + click-through detail over award, vendor, agency, and exclusion data.'
        }
        actions={
          <div className="flex items-center gap-2">
            <ExportMenu
              rows={data?.results ?? []}
              viewName={data?.view_name ?? 'awardlens'}
              count={data?.count ?? 0}
              disabled={!data || data.results.length === 0}
            />
            <Button
              variant="secondary"
              size="sm"
              onClick={() => setReloadToken((n) => n + 1)}
              disabled={!active}
            >
              <RefreshCw className="mr-1 h-4 w-4" /> Reload
            </Button>
          </div>
        }
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      {data === null ? (
        <Card><TableSkeleton rows={10} /></Card>
      ) : data.results.length === 0 ? (
        <Card>
          <div className="px-6 py-16 text-center text-sm text-muted-soft italic">
            No awards in this view yet — trigger a Run Now from <strong>Admin → Views</strong>.
          </div>
        </Card>
      ) : (
        <Tabs.Root defaultValue="pivot" className="flex flex-col gap-4">
          <Tabs.List
            aria-label="Analytics views"
            className="inline-flex w-fit items-center gap-1 rounded-xl border border-border bg-brand-teal-deep/40 p-1 backdrop-blur-md"
          >
            <Tabs.Trigger
              value="pivot"
              className="rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-soft transition-colors hover:text-foreground data-[state=active]:bg-brand-vermilion data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Pivot
            </Tabs.Trigger>
            <Tabs.Trigger
              value="summary"
              className="rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-soft transition-colors hover:text-foreground data-[state=active]:bg-brand-vermilion data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Summary <span className="ml-1 text-[10px] opacity-80">({fmtInt(data.count)})</span>
            </Tabs.Trigger>
          </Tabs.List>

          {/* PIVOT TAB */}
          <Tabs.Content value="pivot" className="focus:outline-none">
            <Card>
              <div className="border-b border-border bg-brand-teal-deep/40 px-5 py-3">
                <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
                  Pivot — drag any field
                </div>
                <div className="mt-0.5 text-xs text-muted">
                  Pivot table from <a href="https://react-pivottable.js.org" target="_blank" rel="noreferrer" className="text-brand-sage hover:text-foreground">react-pivottable.js.org</a> · 32 fields available · multi-aggregator (Sum, Count, Average, Median, Count Unique, etc.)
                </div>
              </div>
              <ErrorBoundary label="Pivot grid error">
                {/* Outer p-4 holds the chrome; inner div is the horizontal-scroll
                    container so wide pivots get a scrollbar instead of clipping.
                    PivotShell injects inline styles on every <select> as a final
                    cascade-proof guarantee that the cream-pill look applies. */}
                <div className="p-4">
                  <PivotShell
                    pivotData={pivotData}
                    pivotState={pivotState}
                    setPivotState={setPivotState}
                  />
                </div>
              </ErrorBoundary>
            </Card>
          </Tabs.Content>

          {/* SUMMARY TAB */}
          <Tabs.Content value="summary" className="focus:outline-none">
            <AwardBrowser rows={data.results} onSelect={setSelectedAward} />
          </Tabs.Content>
        </Tabs.Root>
      )}

      <AwardDetail award={selectedAward} onClose={() => setSelectedAward(null)} />
    </div>
  );
}

// ─── Pivot shell with cascade-proof <select> styling ───────────────────────
//
// Cascade hell: react-pivottable's renderer / aggregator / value-field
// dropdowns are native <select> elements, and on Chromium-on-Windows their
// glyph fill is colored by the OS color-scheme regardless of CSS `color`.
// We force light-mode rendering in CSS via `color-scheme: light` and bolt
// inline `!important` styles on every <select> in here as a final guarantee
// — inline `!important` always wins over any external CSS. After every
// render of PivotTableUI we walk the DOM under our wrapper and re-apply.
function PivotShell({
  pivotData, pivotState, setPivotState,
}: {
  pivotData: Record<string, unknown>[];
  pivotState: any;
  setPivotState: (s: any) => void;
}) {
  const wrapRef = React.useRef<HTMLDivElement | null>(null);

  React.useEffect(() => {
    const root = wrapRef.current;
    if (!root) return;
    const apply = () => {
      const selects = root.querySelectorAll<HTMLSelectElement>('select');
      selects.forEach((el) => {
        // setProperty with priority="important" lets us beat any external
        // !important rule via inline-style cascade.
        el.style.setProperty('color', '#0d1f25', 'important');
        el.style.setProperty('-webkit-text-fill-color', '#0d1f25', 'important');
        el.style.setProperty('background-color', '#FBE9D0', 'important');
        el.style.setProperty('color-scheme', 'light', 'important');
        el.style.setProperty('font-weight', '700', 'important');
        el.style.setProperty('font-size', '13px', 'important');
        el.style.setProperty('appearance', 'none', 'important');
        // Also apply to options so the open menu doesn't flash a different
        // colour before the CSS rule catches up.
        Array.from(el.options).forEach((opt) => {
          opt.style.setProperty('color', '#0d1f25', 'important');
          opt.style.setProperty('background-color', '#FBE9D0', 'important');
        });
      });
    };
    apply();
    // PivotTableUI rebuilds the DOM when state changes — observe and re-apply.
    const mo = new MutationObserver(apply);
    mo.observe(root, { childList: true, subtree: true });
    return () => mo.disconnect();
  }, [pivotData, pivotState]);

  return (
    <div ref={wrapRef} className="awardlens-pivot awardlens-pivot--scroll">
      <PivotTableUI
        data={pivotData}
        onChange={(s: any) => setPivotState(s)}
        renderers={{ ...TableRenderers }}
        unusedOrientationCutoff={Infinity}
        {...pivotState}
      />
    </div>
  );
}

// ─── Award browser (clickable list with search) ─────────────────────────────

function AwardBrowser({
  rows, onSelect,
}: {
  rows: Record<string, unknown>[];
  onSelect: (a: Record<string, unknown>) => void;
}) {
  const [search, setSearch] = React.useState('');

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q)),
    );
  }, [rows, search]);

  return (
    <Card>
      <div className="flex items-center justify-between gap-4 border-b border-border bg-brand-teal-deep/40 px-5 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            Browse · click any row for full detail
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {fmtInt(filtered.length)} of {fmtInt(rows.length)} awards
            {search ? ' (filtered)' : ''}
          </div>
        </div>
        <div className="w-72">
          <Label>Search</Label>
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
            <Input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="PIID, vendor, NAICS, anything…"
              className="pl-10"
            />
            {search && (
              <button
                type="button"
                onClick={() => setSearch('')}
                aria-label="Clear"
                className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center text-muted-soft hover:text-foreground"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>
        </div>
      </div>

      <div className="max-h-[640px] overflow-y-auto">
        {filtered.length === 0 ? (
          <div className="px-6 py-12 text-center text-sm text-muted-soft italic">
            No matches.
          </div>
        ) : (
          <ul>
            {filtered.map((row) => (
              <AwardRow key={String(row.award_id)} row={row} onSelect={onSelect} />
            ))}
          </ul>
        )}
      </div>
    </Card>
  );
}

function AwardRow({
  row, onSelect,
}: {
  row: Record<string, unknown>;
  onSelect: (a: Record<string, unknown>) => void;
}) {
  const value = Number(row.current_value ?? 0);
  const days = Number(row.days_to_contract_end);
  const excluded = Number(row.is_excluded) === 1;

  const dayChip = (() => {
    if (!Number.isFinite(days)) return null;
    if (days < 0)   return <Badge variant="ghost">{Math.abs(days)}d ago</Badge>;
    if (days < 30)  return <Badge variant="danger">{days}d left</Badge>;
    if (days < 90)  return <Badge variant="warning">{days}d left</Badge>;
    if (days < 180) return <Badge variant="info">{days}d left</Badge>;
    return <Badge variant="ghost">{days}d</Badge>;
  })();

  return (
    <li>
      <motion.button
        type="button"
        whileHover={{ x: 2 }}
        onClick={() => onSelect(row)}
        className="group flex w-full items-start gap-4 border-b border-border/60 px-5 py-3 text-left transition-colors hover:bg-brand-teal-soft/15"
      >
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <span className="truncate font-medium text-foreground group-hover:text-brand-vermilion-soft">
              {String(row.description ?? '(no description)')}
            </span>
            {excluded && <Badge variant="danger">Excluded vendor</Badge>}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-2 text-[11px] text-muted-soft">
            <span className="font-mono">{String(row.award_piid ?? '—')}</span>
            <span>·</span>
            <span>{String(row.vendor_name ?? '—')}</span>
            <span>·</span>
            <span>{String(row.awarding_agency ?? '—')}</span>
            {row.psc_description ? (
              <>
                <span>·</span>
                <span className="truncate">{String(row.psc_description)}</span>
              </>
            ) : null}
          </div>
        </div>

        <div className="flex shrink-0 flex-col items-end gap-1.5">
          <span className="font-mono text-sm text-brand-vermilion-soft">
            {fmtMoney(value)}
          </span>
          <div className="flex items-center gap-1.5 text-[10px] text-muted">
            <span>{fmtDate(String(row.pop_end_date ?? ''))}</span>
            {dayChip}
          </div>
        </div>

        <Eye className="mt-1 h-4 w-4 shrink-0 text-muted-soft transition-colors group-hover:text-brand-sage" />
      </motion.button>
    </li>
  );
}

// ─── Export menu ────────────────────────────────────────────────────────────

function ExportMenu({
  rows, viewName, count, disabled,
}: {
  rows: Record<string, unknown>[];
  viewName: string;
  count: number;
  disabled: boolean;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <Button variant="primary" size="sm" disabled={disabled} title="Export the raw flat dataset (every row, every column)">
          <Download className="mr-1 h-4 w-4" /> Export {count > 0 && <span className="ml-1 text-[10px] opacity-80">({count})</span>}
        </Button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end"
          sideOffset={8}
          className="z-50 min-w-[260px] overflow-hidden rounded-xl border border-border bg-brand-teal-deep/95 p-2 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="px-3 pt-1 pb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            Raw flat data — every column + Nature of work
          </div>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
            onSelect={() => exportCsv(rows, viewName)}
          >
            <span className="font-mono text-[10px] uppercase text-muted-soft w-10">CSV</span>
            <div className="flex-1">
              <div className="font-medium">CSV (Excel-friendly)</div>
              <div className="text-[10px] text-muted-soft">RFC 4180 with UTF-8 BOM</div>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
            onSelect={() => exportTsv(rows, viewName)}
          >
            <span className="font-mono text-[10px] uppercase text-muted-soft w-10">TSV</span>
            <div className="flex-1">
              <div className="font-medium">TSV (paste into Sheets)</div>
              <div className="text-[10px] text-muted-soft">tab-separated</div>
            </div>
          </DropdownMenu.Item>
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
            onSelect={() => exportJson(rows, viewName)}
          >
            <span className="font-mono text-[10px] uppercase text-muted-soft w-10">JSON</span>
            <div className="flex-1">
              <div className="font-medium">JSON</div>
              <div className="text-[10px] text-muted-soft">pretty-printed array of objects</div>
            </div>
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
