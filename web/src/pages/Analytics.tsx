import * as React from 'react';
import 'webdatarocks/webdatarocks.min.css';
// WebDataRocks ships ESM. We import the namespace and mount via ref —
// `react-webdatarocks` (the React wrapper) targets React 17 and crashes
// on React 18, so we skip it entirely.
import WebDataRocks from 'webdatarocks';

import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { useViewQuery, useViews } from '@/lib/view-context';
import { NoViewSelected } from '@/components/ui/NoViewSelected';
import { fmtInt } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { RefreshCw } from 'lucide-react';

// ─── Field mapping (all 31 columns from /explore) ───────────────────────────

const MAPPING: Record<string, { type: string; caption: string }> = {
  award_piid:           { type: 'string',      caption: 'PIID' },
  parent_piid:          { type: 'string',      caption: 'Parent PIID' },
  award_id:             { type: 'string',      caption: 'Internal ID' },
  solicitation_id:      { type: 'string',      caption: 'Solicitation' },
  award_type:           { type: 'string',      caption: 'Type' },
  description:          { type: 'string',      caption: 'Description' },
  current_value:        { type: 'number',      caption: 'Current value' },
  obligated_amount:     { type: 'number',      caption: 'Obligated' },
  base_value:           { type: 'number',      caption: 'Base value' },
  currency_code:        { type: 'string',      caption: 'Currency' },
  pop_start_date:       { type: 'date string', caption: 'PoP start' },
  pop_end_date:         { type: 'date string', caption: 'Contract end' },
  source_last_modified: { type: 'date string', caption: 'Last modified' },
  days_to_contract_end: { type: 'number',      caption: 'Days to end' },
  vendor_name:          { type: 'string',      caption: 'Vendor' },
  vendor_uei:           { type: 'string',      caption: 'Vendor UEI' },
  vendor_state:         { type: 'string',      caption: 'Vendor state' },
  vendor_city:          { type: 'string',      caption: 'Vendor city' },
  vendor_country:       { type: 'string',      caption: 'Vendor country' },
  vendor_zip:           { type: 'string',      caption: 'Vendor zip' },
  awarding_agency:      { type: 'string',      caption: 'Awarding agency' },
  awarding_department:  { type: 'string',      caption: 'Awarding dept.' },
  naics_code:           { type: 'string',      caption: 'NAICS' },
  naics_description:    { type: 'string',      caption: 'NAICS description' },
  psc_code:             { type: 'string',      caption: 'PSC' },
  psc_description:      { type: 'string',      caption: 'PSC description' },
  pop_country:          { type: 'string',      caption: 'PoP country' },
  pop_state:            { type: 'string',      caption: 'PoP state' },
  pop_city:             { type: 'string',      caption: 'PoP city' },
  pop_district:         { type: 'string',      caption: 'PoP district' },
  is_excluded:          { type: 'number',      caption: 'Excluded?' },
};

function defaultReport(rows: Record<string, unknown>[], viewName: string) {
  return {
    dataSource: { data: rows, mapping: MAPPING },
    slice: {
      rows:    [{ uniqueName: 'awarding_agency' }],
      columns: [{ uniqueName: 'award_type' }, { uniqueName: '[Measures]' }],
      measures: [
        { uniqueName: 'current_value', aggregation: 'sum',   format: 'currency' },
        { uniqueName: 'award_piid',    aggregation: 'count', caption: 'Count' },
      ],
    },
    formats: [{
      name: 'currency',
      thousandsSeparator: ',',
      decimalSeparator: '.',
      decimalPlaces: 0,
      currencySymbol: '$',
      currencySymbolAlign: 'left',
    }],
    options: {
      grid: {
        type: 'compact',
        showGrandTotals: 'on',
        showTotals: 'on',
        title: viewName,
      },
    },
  };
}

// ─── Inner pivot component ──────────────────────────────────────────────────

function PivotGrid({
  rows, viewName,
}: {
  rows: Record<string, unknown>[];
  viewName: string;
}) {
  const containerRef = React.useRef<HTMLDivElement>(null);
  const pivotRef     = React.useRef<any>(null);

  // Mount the pivot once when the container is in the DOM
  React.useEffect(() => {
    if (!containerRef.current) return;
    try {
      pivotRef.current = new (WebDataRocks as any)({
        container: containerRef.current,
        toolbar: true,
        report: defaultReport(rows, viewName),
        width: '100%',
        height: '100%',
        global: { localization: 'en' },
        beforetoolbarcreated: (toolbar: any) => {
          // Trim the "Connect" tab — data flows through /explore only.
          const oldGetTabs = toolbar.getTabs;
          toolbar.getTabs = function () {
            const tabs = oldGetTabs.call(this);
            return tabs.filter((t: any) => t.id !== 'wdr-tab-connect');
          };
        },
      });
    } catch (err) {
      console.error('WebDataRocks failed to initialize', err);
    }
    return () => {
      try { pivotRef.current?.dispose?.(); } catch { /* noop */ }
      pivotRef.current = null;
    };
    // Mount once. Data updates flow through the next effect.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Re-feed data when rows change (without re-creating the grid)
  React.useEffect(() => {
    const grid = pivotRef.current;
    if (!grid) return;
    try {
      grid.updateData({ data: rows, mapping: MAPPING });
      grid.refresh?.();
    } catch (err) {
      console.error('WebDataRocks updateData failed', err);
    }
  }, [rows]);

  return (
    <div
      ref={containerRef}
      className="awardlens-pivot"
      style={{ width: '100%', height: '100%', minHeight: 540 }}
    />
  );
}

// ─── Page ───────────────────────────────────────────────────────────────────

interface ExploreResponse {
  view_id: string;
  view_name: string;
  count: number;
  results: Record<string, unknown>[];
}

export function AnalyticsPage() {
  const viewQuery = useViewQuery();
  const { active, loading: viewsLoading } = useViews();
  const [data, setData] = React.useState<ExploreResponse | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

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

  if (!viewsLoading && !active) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Analytics"
          description="Pivot grid over award, vendor, agency, and exclusion data — scoped to the active view."
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
            ? `${fmtInt(data.count)} awards in "${data.view_name}" — drag fields between Rows / Columns / Measures to pivot. Use the toolbar for filters, conditional formatting, and export.`
            : 'Pivot grid over award, vendor, agency, and exclusion data — scoped to the active view.'
        }
        actions={
          <Button
            variant="secondary"
            size="sm"
            onClick={() => setReloadToken((n) => n + 1)}
            disabled={!active}
          >
            <RefreshCw className="mr-1 h-4 w-4" /> Reload
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      <Card>
        {data === null ? (
          <TableSkeleton rows={10} />
        ) : data.results.length === 0 ? (
          <div className="px-6 py-16 text-center text-sm text-muted-soft italic">
            No awards in this view yet — trigger a Run Now from <strong>Admin → Views</strong>.
          </div>
        ) : (
          <div className="p-2" style={{ height: 'calc(100vh - 240px)', minHeight: 540 }}>
            <ErrorBoundary label="Pivot grid error">
              <PivotGrid rows={data.results} viewName={data.view_name} />
            </ErrorBoundary>
          </div>
        )}
      </Card>
    </div>
  );
}
