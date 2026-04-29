import * as React from 'react';
// @ts-expect-error — react-pivottable ships its own types only sometimes; the
// PivotTableUI export is a default React class.
import PivotTableUI from 'react-pivottable/PivotTableUI';
// @ts-expect-error — same as above
import TableRenderers from 'react-pivottable/TableRenderers';
import 'react-pivottable/pivottable.css';
import { motion } from 'framer-motion';
import { RefreshCw, Download, Search, X, Eye, ChevronDown, Check, Filter, ChevronRight } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Tabs from '@radix-ui/react-tabs';
import * as Slider from '@radix-ui/react-slider';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Input, Label } from '@/components/ui/Input';
import { Badge } from '@/components/ui/Badge';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { useViewQuery, useViews } from '@/lib/view-context';
import { useAuth } from '@/lib/auth-context';
import { NoViewSelected } from '@/components/ui/NoViewSelected';
import { fmtInt, fmtMoney, fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AwardDetail } from '@/components/AwardDetail';
import { natureOfWork } from '@/lib/nature-of-work';
import { DataCoverageTree } from '@/components/viz/DataCoverageTree';
import { buildSpendTree } from '@/components/viz/buildSpendTree';

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
  { key: 'center_code',         caption: 'Center code' },
  { key: 'center_name',         caption: 'Center' },
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
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';
  const [data,  setData]  = React.useState<ExploreResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);
  const [pivotState, setPivotState] = React.useState<any>(DEFAULT_PIVOT_STATE);
  const [selectedAward, setSelectedAward] = React.useState<Record<string, unknown> | null>(null);

  // Admins can browse the full warehouse without picking a filter; everyone
  // else has to wait for an active filter selection.
  const canQuery = !viewsLoading && (!!active || isAdmin);

  React.useEffect(() => {
    if (!canQuery) return;
    let alive = true;
    setData(null); setError(null);
    (async () => {
      try {
        // viewQuery is undefined when admin is unscoped — /explore handles
        // that case by returning the full warehouse.
        const r = await api.get<ExploreResponse>('/explore', viewQuery);
        if (alive) setData(r);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [canQuery, viewQuery?.filter_id, reloadToken]);

  const pivotData = React.useMemo(
    () => (data ? transformForPivot(data.results) : []),
    [data],
  );

  if (!viewsLoading && !active && !isAdmin) {
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
            <Tabs.Trigger
              value="tree"
              className="rounded-lg px-4 py-1.5 text-xs font-semibold uppercase tracking-[0.14em] text-muted-soft transition-colors hover:text-foreground data-[state=active]:bg-brand-vermilion data-[state=active]:text-white data-[state=active]:shadow-sm"
            >
              Tree
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

          {/* TREE TAB */}
          <Tabs.Content value="tree" className="focus:outline-none">
            <SpendTreeTab
              rows={data.results}
              viewName={data.view_name}
              onSelect={setSelectedAward}
            />
          </Tabs.Content>
        </Tabs.Root>
      )}

      <AwardDetail award={selectedAward} onClose={() => setSelectedAward(null)} />
    </div>
  );
}

// ─── Pivot shell with custom Radix-based picker toolbar ─────────────────────
//
// react-pivottable's built-in renderer / aggregator / value-field dropdowns
// are native <select> elements, which on certain Windows browser
// configurations render with OS-controlled glyph colors that ignore CSS
// (and even inline `!important` styles via setProperty). After multiple
// rounds of CSS+JS overrides failed to make the text legible in the user's
// environment, we stopped fighting native form rendering and replaced
// those dropdowns entirely:
//
//   1. CSS rule `.awardlens-pivot select { display: none !important }`
//      hides every native select inside the pivot grid.
//   2. A toolbar of three custom Radix DropdownMenu pickers (View as /
//      Aggregate / Value field) renders above the pivot. Each picker
//      writes directly to `pivotState`, which PivotTableUI consumes via
//      the spread `{...pivotState}` prop. Same data flow, fully
//      controllable styling.

const RENDERER_OPTIONS = [
  'Table',
  'Table Heatmap',
  'Table Col Heatmap',
  'Table Row Heatmap',
  'Exportable TSV',
];

const AGGREGATOR_OPTIONS = [
  'Count',
  'Count Unique Values',
  'List Unique Values',
  'Sum',
  'Integer Sum',
  'Average',
  'Median',
  'Sample Variance',
  'Sample Standard Deviation',
  'Minimum',
  'Maximum',
  'First',
  'Last',
  'Sum as Fraction of Total',
  'Sum as Fraction of Rows',
  'Sum as Fraction of Columns',
  'Count as Fraction of Total',
  'Count as Fraction of Rows',
  'Count as Fraction of Columns',
];

// react-pivottable accepts these three magic strings on rowOrder / colOrder.
// We expose them with friendlier captions and translate at the picker.
const SORT_OPTIONS: Array<{ caption: string; value: 'key_a_to_z' | 'value_a_to_z' | 'value_z_to_a' }> = [
  { caption: 'A → Z (alphabetical)',     value: 'key_a_to_z'   },
  { caption: 'Lowest total first (↑)',   value: 'value_a_to_z' },
  { caption: 'Highest total first (↓)',  value: 'value_z_to_a' },
];
function sortCaptionFor(v: string | undefined): string {
  return SORT_OPTIONS.find((o) => o.value === v)?.caption ?? SORT_OPTIONS[0].caption;
}

function ToolbarPicker({
  label, value, options, onChange, minWidth = 220,
}: {
  label: string;
  value: string;
  options: string[];
  onChange: (v: string) => void;
  minWidth?: number;
}) {
  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="group flex items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/60 px-3 py-1.5 text-sm transition-colors hover:border-brand-vermilion hover:bg-brand-teal-soft/30"
        >
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            {label}
          </span>
          <span className="font-semibold text-foreground">{value}</span>
          <ChevronDown className="h-3.5 w-3.5 text-muted-soft transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-[420px] overflow-y-auto rounded-xl border border-border bg-brand-teal-deep/95 p-2 shadow-glass-lg backdrop-blur-xl"
          style={{ minWidth }}
        >
          {options.map((opt) => {
            const selected = opt === value;
            return (
              <DropdownMenu.Item
                key={opt}
                onSelect={() => onChange(opt)}
                className={`flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30 ${
                  selected ? 'text-brand-vermilion-soft' : 'text-foreground'
                }`}
              >
                <span className="flex-1 truncate">{opt}</span>
                {selected && <Check className="h-4 w-4 shrink-0" />}
              </DropdownMenu.Item>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

/**
 * Custom field-filter picker. Replaces the click-the-▾-on-a-chip filter
 * popup that react-pivottable ships built-in (and which on certain
 * browser configs renders with the same unreadable peach-on-cream text
 * that the renderer/aggregator dropdowns suffered from).
 *
 * UX: a single "Filters" pill in the toolbar. Click it to see a dropdown
 * of every field currently used in rows / cols / vals. Hovering a field
 * opens a submenu with every unique value as a checkbox — toggle to
 * include / exclude. Active exclusions are tracked on
 * pivotState.valueFilter, which PivotTableUI consumes.
 */
function FiltersPicker({
  pivotData, pivotState, setPivotState,
}: {
  pivotData: Record<string, unknown>[];
  pivotState: any;
  setPivotState: (s: any) => void;
}) {
  // Compute every unique value per field (using friendly column captions
  // — those are what end up in pivotState.rows / cols / vals after our
  // transformForPivot pass).
  const uniqueValuesByField = React.useMemo(() => {
    const m: Record<string, string[]> = {};
    pivotData.forEach((row) => {
      Object.entries(row).forEach(([k, v]) => {
        if (k === '__raw') return;
        if (!m[k]) m[k] = [];
        const sv = v == null || v === '' ? '(empty)' : String(v);
        if (!m[k].includes(sv)) m[k].push(sv);
      });
    });
    Object.keys(m).forEach((k) => m[k].sort((a, b) => a.localeCompare(b)));
    return m;
  }, [pivotData]);

  // Filterable = anything currently dropped into rows / cols / vals.
  const filterableFields = React.useMemo(() => {
    const s = new Set<string>();
    (pivotState.rows ?? []).forEach((f: string) => s.add(f));
    (pivotState.cols ?? []).forEach((f: string) => s.add(f));
    (pivotState.vals ?? []).forEach((f: string) => s.add(f));
    return Array.from(s);
  }, [pivotState]);

  const valueFilter: Record<string, Record<string, boolean>> = pivotState.valueFilter ?? {};

  const isIncluded = (field: string, value: string) =>
    !valueFilter[field]?.[value];

  const toggleValue = (field: string, value: string) => {
    const cur = valueFilter[field] ?? {};
    const next = { ...cur };
    if (next[value]) delete next[value];
    else next[value] = true;
    const allFilters = { ...valueFilter, [field]: next };
    if (Object.keys(next).length === 0) delete allFilters[field];
    setPivotState({ ...pivotState, valueFilter: allFilters });
  };

  const setAllForField = (field: string, included: boolean) => {
    const allValues = uniqueValuesByField[field] ?? [];
    const next: Record<string, boolean> = {};
    if (!included) allValues.forEach((v) => { next[v] = true; });
    const allFilters = { ...valueFilter, [field]: next };
    if (Object.keys(next).length === 0) delete allFilters[field];
    setPivotState({ ...pivotState, valueFilter: allFilters });
  };

  // Total count of active filters (for the chip badge).
  const totalExclusions = Object.values(valueFilter).reduce(
    (n, m) => n + Object.keys(m).length, 0,
  );

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className="group flex items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/60 px-3 py-1.5 text-sm transition-colors hover:border-brand-vermilion hover:bg-brand-teal-soft/30"
        >
          <Filter className="h-3.5 w-3.5 text-brand-sage" />
          <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            Filters
          </span>
          {totalExclusions > 0 ? (
            <span className="rounded-full bg-brand-vermilion px-1.5 py-0.5 text-[10px] font-bold text-white">
              {totalExclusions}
            </span>
          ) : (
            <span className="text-xs text-muted-soft">All</span>
          )}
          <ChevronDown className="h-3.5 w-3.5 text-muted-soft transition-transform group-data-[state=open]:rotate-180" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={6}
          className="z-50 max-h-[420px] min-w-[260px] overflow-y-auto rounded-xl border border-border bg-brand-teal-deep/95 p-2 shadow-glass-lg backdrop-blur-xl"
        >
          {filterableFields.length === 0 ? (
            <div className="px-3 py-2 text-xs italic text-muted-soft">
              Drop fields into Rows / Columns / Values to enable filters.
            </div>
          ) : filterableFields.map((field) => {
            const values = uniqueValuesByField[field] ?? [];
            const fieldExclusions = valueFilter[field] ?? {};
            const excludedHere = Object.keys(fieldExclusions).length;
            return (
              <DropdownMenu.Sub key={field}>
                <DropdownMenu.SubTrigger
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30 data-[state=open]:bg-brand-teal-soft/30"
                >
                  <span className="flex-1 truncate">{field}</span>
                  {excludedHere > 0 && (
                    <span className="rounded-full bg-brand-vermilion/80 px-1.5 py-0.5 text-[10px] font-bold text-white">
                      −{excludedHere}
                    </span>
                  )}
                  <ChevronRight className="h-3.5 w-3.5 text-muted-soft" />
                </DropdownMenu.SubTrigger>
                <DropdownMenu.Portal>
                  <DropdownMenu.SubContent
                    sideOffset={6}
                    className="z-50 max-h-[480px] min-w-[280px] max-w-[440px] overflow-y-auto rounded-xl border border-border bg-brand-teal-deep/95 p-2 shadow-glass-lg backdrop-blur-xl"
                  >
                    <div className="flex items-center gap-1 border-b border-border pb-2 mb-2">
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setAllForField(field, true); }}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-brand-sage hover:bg-brand-teal-soft/30"
                      >
                        Select all
                      </button>
                      <button
                        type="button"
                        onClick={(e) => { e.preventDefault(); setAllForField(field, false); }}
                        className="rounded-md px-2 py-1 text-[11px] font-medium text-brand-vermilion-soft hover:bg-brand-vermilion/15"
                      >
                        Clear all
                      </button>
                      <div className="ml-auto text-[10px] text-muted-soft">
                        {values.length - excludedHere} / {values.length}
                      </div>
                    </div>
                    {values.map((v) => {
                      const inc = isIncluded(field, v);
                      return (
                        <DropdownMenu.CheckboxItem
                          key={v}
                          checked={inc}
                          onCheckedChange={() => toggleValue(field, v)}
                          onSelect={(e) => e.preventDefault()}
                          className={`flex cursor-pointer items-start gap-2 rounded-md px-3 py-1.5 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30 ${
                            inc ? 'text-foreground' : 'text-muted-soft line-through'
                          }`}
                        >
                          <div className={`mt-0.5 grid h-4 w-4 shrink-0 place-items-center rounded border ${
                            inc ? 'border-brand-vermilion bg-brand-vermilion/20' : 'border-border bg-transparent'
                          }`}>
                            {inc && <Check className="h-3 w-3 text-brand-vermilion-soft" />}
                          </div>
                          <span className="flex-1 break-words">{v}</span>
                        </DropdownMenu.CheckboxItem>
                      );
                    })}
                  </DropdownMenu.SubContent>
                </DropdownMenu.Portal>
              </DropdownMenu.Sub>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}

function PivotShell({
  pivotData, pivotState, setPivotState,
}: {
  pivotData: Record<string, unknown>[];
  pivotState: any;
  setPivotState: (s: any) => void;
}) {
  // Available value-field options = every column + the derived "Nature of work".
  const valueOptions = React.useMemo(
    () => [...COLUMNS.map((c) => c.caption), 'Nature of work'],
    [],
  );

  const rendererName  = pivotState.rendererName  ?? 'Table';
  const aggregatorName = pivotState.aggregatorName ?? 'Sum';
  const valueField    = pivotState.vals?.[0]      ?? 'Current value';
  const rowOrder      = pivotState.rowOrder       ?? 'key_a_to_z';
  const colOrder      = pivotState.colOrder       ?? 'key_a_to_z';

  const setSort = (which: 'rowOrder' | 'colOrder', caption: string) => {
    const value = SORT_OPTIONS.find((o) => o.caption === caption)?.value ?? 'key_a_to_z';
    setPivotState({ ...pivotState, [which]: value });
  };

  return (
    <div>
      {/* Custom picker toolbar (replaces the broken native <select>s). */}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <ToolbarPicker
          label="View as"
          value={rendererName}
          options={RENDERER_OPTIONS}
          onChange={(v) => setPivotState({ ...pivotState, rendererName: v })}
        />
        <ToolbarPicker
          label="Aggregate"
          value={aggregatorName}
          options={AGGREGATOR_OPTIONS}
          onChange={(v) => setPivotState({ ...pivotState, aggregatorName: v })}
        />
        <ToolbarPicker
          label="Value field"
          value={valueField}
          options={valueOptions}
          minWidth={260}
          onChange={(v) =>
            setPivotState({
              ...pivotState,
              vals: [v],
              // If user hasn't picked an aggregator yet but is changing
              // the value, default to Sum (matches default).
              aggregatorName: pivotState.aggregatorName ?? 'Sum',
            })
          }
        />
        <div className="mx-1 h-5 w-px bg-border/60" />
        <ToolbarPicker
          label="Sort rows"
          value={sortCaptionFor(rowOrder)}
          options={SORT_OPTIONS.map((o) => o.caption)}
          minWidth={240}
          onChange={(v) => setSort('rowOrder', v)}
        />
        <ToolbarPicker
          label="Sort columns"
          value={sortCaptionFor(colOrder)}
          options={SORT_OPTIONS.map((o) => o.caption)}
          minWidth={240}
          onChange={(v) => setSort('colOrder', v)}
        />
        <div className="mx-1 h-5 w-px bg-border/60" />
        <FiltersPicker
          pivotData={pivotData}
          pivotState={pivotState}
          setPivotState={setPivotState}
        />
      </div>

      <div className="awardlens-pivot awardlens-pivot--scroll">
        <PivotTableUI
          data={pivotData}
          onChange={(s: any) => setPivotState(s)}
          renderers={{ ...TableRenderers }}
          unusedOrientationCutoff={Infinity}
          {...pivotState}
        />
      </div>
    </div>
  );
}

// ─── Spend tree (D3 hierarchy) ──────────────────────────────────────────────

function SpendTreeTab({
  rows, viewName, onSelect,
}: {
  rows: Record<string, unknown>[];
  viewName: string;
  onSelect: (a: Record<string, unknown>) => void;
}) {
  const tree = React.useMemo(() => buildSpendTree(rows, { rootTitle: viewName || 'CDC' }), [rows, viewName]);

  const totals = React.useMemo(() => {
    let total = 0;
    let unenriched = 0;
    let urgent = 0;
    for (const r of rows) {
      total += Number(r.current_value ?? 0);
      const codes = String(r.federal_account_codes ?? '');
      if (!codes) unenriched += 1;
      const days = Number(r.days_to_contract_end);
      if (Number.isFinite(days) && days < 30) urgent += 1;
    }
    return { total, unenriched, urgent };
  }, [rows]);

  const fmtT = (n: number) => {
    if (Math.abs(n) >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (Math.abs(n) >= 1e6) return '$' + (n / 1e6).toFixed(2) + 'M';
    return '$' + Math.round(n).toLocaleString();
  };

  return (
    <Card>
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-brand-teal-deep/40 px-5 py-3">
        <div>
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            Spend tree · click branches to expand · click a leaf for full detail
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {viewName} · {fmtInt(rows.length)} contracts · {fmtT(totals.total)} total
            {totals.unenriched > 0 && (
              <span className="ml-2 text-amber-300">
                ({fmtInt(totals.unenriched)} unenriched — landed under "Unclassified")
              </span>
            )}
          </div>
        </div>

        {/* Legend */}
        <div className="flex items-center gap-3 text-[11px] text-muted-soft">
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#244855' }} />
            Root
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#90AEAD' }} />
            Group
          </span>
          <span className="mx-1 text-muted-soft/60">|</span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#90AEAD' }} />
            &gt; 180d left
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#874F41' }} />
            30–180d
          </span>
          <span className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: '#E64833' }} />
            &lt; 30d / expired
          </span>
        </div>
      </div>

      {/* Tree canvas */}
      <div className="relative" style={{ height: 'calc(100vh - 320px)', minHeight: 560 }}>
        <ErrorBoundary label="Spend tree">
          <DataCoverageTree
            data={tree}
            onLeafClick={(node) => {
              const row = node.payload as Record<string, unknown> | undefined;
              if (row) onSelect(row);
            }}
          />
        </ErrorBoundary>
        <div className="pointer-events-none absolute bottom-3 right-4 text-[10px] uppercase tracking-[0.12em] text-muted-soft/70">
          Scroll to zoom · Drag to pan
        </div>
      </div>
    </Card>
  );
}

// ─── Award browser (clickable list with search) ─────────────────────────────

// Convert YYYY-MM-DD ↔ epoch-day (days since 1970-01-01) — gives the slider
// integer bounds without needing a 32-bit timestamp range.
function dateToEpochDay(s: string | null | undefined): number | null {
  if (!s) return null;
  const d = new Date(String(s).slice(0, 10));
  if (Number.isNaN(d.getTime())) return null;
  return Math.floor(d.getTime() / 86400000);
}
function epochDayToDate(d: number): string {
  return new Date(d * 86400000).toISOString().slice(0, 10);
}

function AwardBrowser({
  rows, onSelect,
}: {
  rows: Record<string, unknown>[];
  onSelect: (a: Record<string, unknown>) => void;
}) {
  const [search, setSearch] = React.useState('');
  const [minValue, setMinValue] = React.useState<string>('');
  const [maxValue, setMaxValue] = React.useState<string>('');

  // Date bounds derived from the data — slider operates over these.
  // Only awards with a valid pop_end_date contribute to the bounds; rows
  // with missing dates are kept regardless of the slider position (they
  // can't be meaningfully placed on a date axis).
  const dateBounds = React.useMemo(() => {
    let min = Infinity;
    let max = -Infinity;
    for (const r of rows) {
      const d = dateToEpochDay(r.pop_end_date as string | undefined);
      if (d == null) continue;
      if (d < min) min = d;
      if (d > max) max = d;
    }
    if (!Number.isFinite(min) || !Number.isFinite(max)) return null;
    return { min, max };
  }, [rows]);

  // Two-tier slider state:
  //   pendingDateRange — visual position while the user is dragging (cheap,
  //                      updates per pixel via onValueChange)
  //   dateRange        — committed value used by the filter (only updates on
  //                      onValueCommit, i.e., pointer release)
  // Without this split, dragging across the slider would re-filter 2.5K rows
  // hundreds of times per drag and lock the browser.
  const [pendingDateRange, setPendingDateRange] = React.useState<[number, number] | null>(null);
  const [dateRange,        setDateRange]        = React.useState<[number, number] | null>(null);

  // Reset both when the underlying bounds change (new data load).
  React.useEffect(() => {
    setPendingDateRange(null);
    setDateRange(null);
  }, [dateBounds?.min, dateBounds?.max]);

  const minVNum = minValue.trim() === '' ? null : Number(minValue);
  const maxVNum = maxValue.trim() === '' ? null : Number(maxValue);
  const minVValid = minVNum == null || (Number.isFinite(minVNum) && minVNum >= 0);
  const maxVValid = maxVNum == null || (Number.isFinite(maxVNum) && maxVNum >= 0);

  const filtered = React.useMemo(() => {
    const q = search.trim().toLowerCase();
    const hasSearch = q.length > 0;
    const hasMin = minVNum != null && Number.isFinite(minVNum);
    const hasMax = maxVNum != null && Number.isFinite(maxVNum);
    const hasDate = dateRange != null;
    // Fast path: no filters → return rows reference unchanged so React.memo
    // children don't churn on every keystroke / slider tick.
    if (!hasSearch && !hasMin && !hasMax && !hasDate) return rows;
    return rows.filter((r) => {
      if (hasSearch && !Object.values(r).some((v) => String(v ?? '').toLowerCase().includes(q))) {
        return false;
      }
      if (hasMin || hasMax) {
        const value = Number(r.current_value ?? 0);
        if (hasMin && value < (minVNum as number)) return false;
        if (hasMax && value > (maxVNum as number)) return false;
      }
      if (hasDate) {
        const d = dateToEpochDay(r.pop_end_date as string | undefined);
        // Awards without a date pass through — can't be placed on the axis.
        if (d != null && (d < dateRange![0] || d > dateRange![1])) return false;
      }
      return true;
    });
  }, [rows, search, minVNum, maxVNum, dateRange]);

  const valueActive = minVNum != null || maxVNum != null;
  const dateActive = dateRange != null;
  const anyActive = !!search || valueActive || dateActive;

  function resetAll() {
    setSearch('');
    setMinValue('');
    setMaxValue('');
    setPendingDateRange(null);
    setDateRange(null);
  }

  return (
    <Card>
      <div className="space-y-3 border-b border-border bg-brand-teal-deep/40 px-5 py-3">
        {/* Top row: title + count + reset */}
        <div className="flex items-center justify-between gap-4">
          <div>
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
              Browse · click any row for full detail
            </div>
            <div className="mt-0.5 text-xs text-muted">
              {fmtInt(filtered.length)} of {fmtInt(rows.length)} awards
              {anyActive ? ' (filtered)' : ''}
            </div>
          </div>
          {anyActive && (
            <button
              type="button"
              onClick={resetAll}
              className="rounded-md border border-border px-2 py-1 text-[11px] uppercase tracking-[0.08em] text-muted-soft transition-colors hover:border-brand-vermilion hover:text-brand-vermilion-soft"
            >
              <X className="mr-1 inline h-3 w-3" /> Clear all
            </button>
          )}
        </div>

        {/* Filter row — search + value + date */}
        <div className="grid gap-3 md:grid-cols-[1fr_auto_1fr]">
          {/* Search */}
          <div>
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
                  aria-label="Clear search"
                  className="absolute right-2 top-1/2 grid h-6 w-6 -translate-y-1/2 place-items-center text-muted-soft hover:text-foreground"
                >
                  <X className="h-3 w-3" />
                </button>
              )}
            </div>
          </div>

          {/* Value */}
          <div className="min-w-0">
            <Label>Current value</Label>
            <div className="flex items-center gap-1.5">
              <Input
                value={minValue}
                onChange={(e) => setMinValue(e.target.value)}
                placeholder="min"
                inputMode="numeric"
                aria-invalid={!minVValid}
                className={`w-24 font-mono text-sm ${!minVValid ? 'border-brand-vermilion' : ''}`}
              />
              <span className="text-xs text-muted-soft">–</span>
              <Input
                value={maxValue}
                onChange={(e) => setMaxValue(e.target.value)}
                placeholder="max"
                inputMode="numeric"
                aria-invalid={!maxVValid}
                className={`w-24 font-mono text-sm ${!maxVValid ? 'border-brand-vermilion' : ''}`}
              />
            </div>
            <div className="mt-1 flex flex-wrap gap-1">
              {[
                { label: '≥ $4M',   min: 4_000_000   },
                { label: '≥ $10M',  min: 10_000_000  },
                { label: '≥ $50M',  min: 50_000_000  },
                { label: '≥ $100M', min: 100_000_000 },
              ].map((p) => (
                <button
                  key={p.label}
                  type="button"
                  onClick={() => { setMinValue(String(p.min)); setMaxValue(''); }}
                  className="rounded-md border border-border bg-brand-teal-deep/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-soft transition-colors hover:border-brand-sage hover:text-foreground"
                >
                  {p.label}
                </button>
              ))}
            </div>
          </div>

          {/* Date slider */}
          <div className="min-w-0">
            <div className="flex items-baseline justify-between gap-2">
              <Label>Contract end date</Label>
              <span className="font-mono text-[11px] text-muted-soft">
                {dateBounds
                  ? `${epochDayToDate(pendingDateRange?.[0] ?? dateRange?.[0] ?? dateBounds.min)} → ${epochDayToDate(pendingDateRange?.[1] ?? dateRange?.[1] ?? dateBounds.max)}`
                  : '—'}
              </span>
            </div>
            {dateBounds ? (
              <Slider.Root
                className="relative flex h-7 w-full touch-none select-none items-center"
                min={dateBounds.min}
                max={dateBounds.max}
                step={1}
                value={pendingDateRange ?? dateRange ?? [dateBounds.min, dateBounds.max]}
                onValueChange={(v) => {
                  // Cheap: only the visual handle position. No filter recompute.
                  if (v.length !== 2) return;
                  setPendingDateRange([v[0]!, v[1]!]);
                }}
                onValueCommit={(v) => {
                  // Pointer release — commit to the actual filter state.
                  if (v.length !== 2) return;
                  if (v[0] === dateBounds.min && v[1] === dateBounds.max) {
                    setDateRange(null);
                    setPendingDateRange(null);
                  } else {
                    setDateRange([v[0]!, v[1]!]);
                    setPendingDateRange(null);
                  }
                }}
                aria-label="Contract end date range"
              >
                <Slider.Track className="relative h-1 grow rounded-full bg-brand-teal-deep">
                  <Slider.Range className="absolute h-full rounded-full bg-brand-vermilion" />
                </Slider.Track>
                <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border border-brand-vermilion bg-brand-cream shadow-md outline-none transition-transform hover:scale-110 focus:ring-2 focus:ring-brand-vermilion/50" />
                <Slider.Thumb className="block h-3.5 w-3.5 rounded-full border border-brand-vermilion bg-brand-cream shadow-md outline-none transition-transform hover:scale-110 focus:ring-2 focus:ring-brand-vermilion/50" />
              </Slider.Root>
            ) : (
              <div className="text-[11px] italic text-muted-soft">No dated awards in this set.</div>
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

// React.memo'd so individual rows don't re-render when only the search/filter
// state changes upstream. With ~2,500 rows in the unscoped admin view this
// shaves seconds off every keystroke.
const AwardRow = React.memo(function AwardRow({
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
});

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
