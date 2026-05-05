import * as React from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { CalendarDays, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { SaveSearchModal, type SaveSearchConfig } from '@/components/ui/SaveSearchModal';
import { TextSnapshot } from '@/components/ui/TextSnapshot';
import { AIBadge } from '@/components/ui/AISummaryToggle';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Federal Contract Opportunities — list view (spec §3.2). Wires every
 * shared component end-to-end so the rest of Phase 1 has a working
 * template to copy.
 *
 * Data source for this view:
 *   - Phase 0 (now): mock rows, real components, working filters
 *   - Phase 1 (next): wire to GET /opportunities/contract via TanStack Query
 *
 * Filters mirror the audit-observed set:
 *   Quick:  Active, Exclude No Bid, My Favorites, My Pursuits,
 *           Exclude Sole Source, Future Vehicle, Only Civilian, Only Defense
 *   Search: Keywords, Agency, Date Due, Date Posted, FSG/NSG, Match,
 *           NAICS, NSN, Opportunity Type, Region
 */

interface OppRow {
  opportunity_id: string;
  slug: string;
  title: string;
  type: string;
  agency: string;
  set_aside: string;
  posted_at: string;
  deadline: string;
  description_summary?: string | null;
  ai_value_min?: number | null;
  ai_value_max?: number | null;
  is_near_deadline?: boolean;
}

export function ContractOpportunitiesListPage() {
  const [filters, setFilters] = React.useState<FilterState>({
    quick: { active: true },
    search: {},
  });
  const [saveOpen, setSaveOpen] = React.useState(false);

  // Real data path → swap this to useContractOpportunities(filters) once
  // the API hook lands. Until then we render the mock fixture so the UX
  // and components are demo-able today.
  const data = MOCK_ROWS;
  const totalCount = 78_412;

  const columns = React.useMemo<ColumnDef<OppRow, unknown>[]>(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <Link
          to={`/opportunity/contract/${row.original.slug}`}
          className="font-medium text-foreground hover:text-brand-vermilion-soft hover:underline"
        >
          {row.original.title}
        </Link>
      ),
      meta: { minWidth: 320 },
    },
    {
      accessorKey: 'type',
      header: 'Type',
      cell: ({ row }) => (
        <span className="rounded-full bg-brand-teal-soft/30 px-2 py-0.5 text-[11px] uppercase tracking-wide text-muted">
          {row.original.type}
        </span>
      ),
    },
    {
      accessorKey: 'agency',
      header: 'Agency',
      cell: ({ row }) => <span className="text-muted">{row.original.agency}</span>,
      meta: { minWidth: 200 },
    },
    {
      accessorKey: 'set_aside',
      header: 'Set Aside',
      cell: ({ row }) => <span className="text-muted">{row.original.set_aside}</span>,
    },
    {
      accessorKey: 'ai_value_max',
      header: () => <span className="inline-flex items-center gap-1"><Sparkles className="h-3 w-3" /> Est. value</span>,
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5">
          <AIBadge label="AI" />
          {row.original.ai_value_min
            ? `${fmtMoney(row.original.ai_value_min)} – ${fmtMoney(row.original.ai_value_max ?? null)}`
            : '—'}
        </span>
      ),
      meta: { numeric: true, minWidth: 180 },
    },
    {
      accessorKey: 'posted_at',
      header: 'Posted',
      cell: ({ row }) => fmtDate(row.original.posted_at),
      meta: { numeric: true },
    },
    {
      accessorKey: 'deadline',
      header: 'Deadline',
      cell: ({ row }) => (
        <span className="inline-flex items-center gap-1.5 tabular-nums">
          {row.original.is_near_deadline && (
            <span className="h-2 w-2 rounded-full bg-emerald-400 ring-2 ring-emerald-400/30" />
          )}
          {fmtDate(row.original.deadline)}
        </span>
      ),
      meta: { numeric: true },
    },
  ], []);

  const onExport = (format: string, count: number) => {
    toast.success(`Queued ${count.toLocaleString()} rows as ${format.toUpperCase()} — you'll get an email when ready.`);
  };

  const onSaveSearch = async (config: SaveSearchConfig) => {
    toast.success(`Saved "${config.name}" — ${config.alert_frequency} alerts via ${describeChannels(config.channels)}.`);
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Business Development"
        title="Federal Contract Opportunities"
        description="Searchable index of federal contract solicitations, presolicitations, special notices, forecasts, and DIBBS. AI-summarized descriptions and value estimates on every row."
        actions={
          <div className="flex items-center gap-1.5">
            <ExportDropdown totalCount={totalCount} tierLimit={20_000} onExport={onExport as never} />
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30"
            >
              <CalendarDays className="h-3.5 w-3.5" />
              Save search
            </button>
          </div>
        }
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {totalCount.toLocaleString()} results
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted">
          Forecasts · 140.9K
        </span>
        <span className="rounded-full border border-border px-3 py-1 text-[11px] font-medium text-muted">
          DIBBS · 3M
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[
            { id: 'active',              label: 'Active opportunity' },
            { id: 'exclude_no_bid',      label: 'Exclude no-bid' },
            { id: 'my_favorites',        label: 'My favorites' },
            { id: 'my_pursuits',         label: 'My pursuits' },
            { id: 'exclude_sole_source', label: 'Exclude sole source' },
            { id: 'future_vehicle',      label: 'Future vehicle' },
            { id: 'only_civilian',       label: 'Only civilian' },
            { id: 'only_defense',        label: 'Only defense' },
          ]}
          searchFilters={[
            { id: 'q',           label: 'Keywords',       type: 'text', placeholder: 'e.g. data platform, surveillance' },
            { id: 'agency',      label: 'Agency',         type: 'multi-select', options: AGENCY_OPTS, searchable: true },
            { id: 'naics',       label: 'NAICS',          type: 'multi-select', options: NAICS_OPTS,  searchable: true },
            { id: 'psc',         label: 'PSC',            type: 'multi-select', options: PSC_OPTS },
            { id: 'set_aside',   label: 'Set Aside',      type: 'multi-select', options: SET_ASIDE_OPTS },
            { id: 'opp_type',    label: 'Opportunity type', type: 'multi-select', options: OPP_TYPE_OPTS },
            { id: 'date_posted', label: 'Date posted',    type: 'date-range' },
            { id: 'date_due',    label: 'Date due',       type: 'date-range' },
            { id: 'value',       label: 'Estimated value', type: 'number-range', format: 'currency' },
          ]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />

        <DataTable<OppRow>
          columns={columns}
          data={data}
          totalCount={totalCount}
          ariaLabel="Federal contract opportunities"
          columnVisibilityStorageKey="captureradar.contract_opps.cols"
          expandedRowRenderer={(row) => <TextSnapshot text={row.description_summary} />}
          emptyTitle="No opportunities match these filters."
          emptyMessage="Try expanding your date range, removing a NAICS code, or unchecking 'Only civilian'."
        />
      </div>

      <SaveSearchModal
        open={saveOpen}
        onOpenChange={setSaveOpen}
        onSave={onSaveSearch}
        defaultName="Federal contracts — my filter"
      />
    </div>
  );
}

function describeChannels(c: SaveSearchConfig['channels']): string {
  const on = Object.entries(c).filter(([, v]) => v).map(([k]) => k);
  if (on.length === 0) return 'none';
  if (on.length === 1) return on[0];
  return on.slice(0, -1).join(', ') + ' + ' + on[on.length - 1];
}

// ─── Mock data (Phase 0 demo dataset) ──────────────────────────────────────

const MOCK_ROWS: OppRow[] = [
  {
    opportunity_id: 'opp-1', slug: 'cdc-data-platform-modernization-fy26',
    title: 'CDC Data Platform Modernization — FY26 Phase II',
    type: 'Solicitation', agency: 'Centers for Disease Control', set_aside: '8(a)',
    posted_at: '2026-04-12T10:00:00Z', deadline: '2026-06-15T17:00:00Z',
    is_near_deadline: true,
    ai_value_min: 12_000_000, ai_value_max: 24_000_000,
    description_summary: 'Multi-year IDIQ for cloud-native data engineering supporting NCHHSTP surveillance dashboards. PoP includes one base year plus four option years.',
  },
  {
    opportunity_id: 'opp-2', slug: 'army-amc-aviation-logistics-bpa',
    title: 'AMC Aviation Logistics Support BPA',
    type: 'Solicitation', agency: 'U.S. Army Materiel Command', set_aside: 'SDVOSB',
    posted_at: '2026-03-28T09:00:00Z', deadline: '2026-05-28T17:00:00Z',
    is_near_deadline: true,
    ai_value_min: 45_000_000, ai_value_max: 90_000_000,
    description_summary: 'BPA covering rotary-wing logistics, MRO scheduling, and supply-chain analytics for the AMC enterprise. AS9100D certification required.',
  },
  {
    opportunity_id: 'opp-3', slug: 'va-tele-mental-health-platform',
    title: 'VA Tele-Mental Health Platform — Recompete',
    type: 'Presolicitation', agency: 'Veterans Affairs', set_aside: 'WOSB',
    posted_at: '2026-04-22T11:00:00Z', deadline: '2026-07-02T17:00:00Z',
    ai_value_min: 6_500_000, ai_value_max: 15_000_000,
    description_summary: 'Recompete of FY21 VA tele-health program. Reduced provider-to-veteran latency, FedRAMP High posture, integration with VistA Evolution.',
  },
  {
    opportunity_id: 'opp-4', slug: 'dhs-border-imagery-analytics',
    title: 'DHS Border Imagery Analytics — Special Notice',
    type: 'Special Notice', agency: 'Homeland Security', set_aside: 'None',
    posted_at: '2026-04-30T14:00:00Z', deadline: '2026-08-19T17:00:00Z',
    ai_value_min: 100_000_000, ai_value_max: 250_000_000,
    description_summary: 'Pre-solicitation for ML-driven imagery analytics across CBP southern-border sensor towers. Edge inference + on-device redaction; classified annex available.',
  },
  {
    opportunity_id: 'opp-5', slug: 'navy-undersea-cable-monitoring-rfi',
    title: 'NAVY Undersea Cable Monitoring — RFI',
    type: 'Synopsis Solicitation', agency: 'Department of the Navy', set_aside: 'None',
    posted_at: '2026-04-15T08:00:00Z', deadline: '2026-05-30T17:00:00Z',
    is_near_deadline: true,
    ai_value_min: 30_000_000, ai_value_max: 80_000_000,
    description_summary: 'Request for Information on persistent undersea cable monitoring capabilities. Vendors with sonar-ML and acoustic-event-detection experience encouraged.',
  },
  {
    opportunity_id: 'opp-6', slug: 'gsa-mas-it-cat-recompete',
    title: 'GSA MAS — Information Technology Category — Recompete',
    type: 'Solicitation', agency: 'General Services Administration', set_aside: 'None',
    posted_at: '2026-02-01T10:00:00Z', deadline: '2026-07-25T17:00:00Z',
    ai_value_min: 10_000_000_000, ai_value_max: 25_000_000_000,
    description_summary: 'Recompete of GSA MAS IT category — multiple-award schedule covering 541512, 541519, 518210. Vendors must hold active SAM registration and 2-year past performance.',
  },
];

const AGENCY_OPTS = [
  { value: 'cdc',  label: 'Centers for Disease Control' },
  { value: 'va',   label: 'Veterans Affairs' },
  { value: 'dhs',  label: 'Homeland Security' },
  { value: 'amc',  label: 'Army Materiel Command' },
  { value: 'navy', label: 'Department of the Navy' },
  { value: 'gsa',  label: 'General Services Administration' },
  { value: 'dod',  label: 'Department of Defense' },
];

const NAICS_OPTS = [
  { value: '541512', label: '541512 — Computer Systems Design Services' },
  { value: '541511', label: '541511 — Custom Computer Programming Services' },
  { value: '541519', label: '541519 — Other Computer Related Services' },
  { value: '541715', label: '541715 — R&D in Physical Engineering & Life Sciences' },
  { value: '336411', label: '336411 — Aircraft Manufacturing' },
  { value: '622310', label: '622310 — Specialty Hospitals' },
];

const PSC_OPTS = [
  { value: 'DA01', label: 'DA01 — IT Application Development' },
  { value: 'D399', label: 'D399 — Other Information Technology Services' },
  { value: 'R408', label: 'R408 — Program Management Services' },
];

const SET_ASIDE_OPTS = [
  { value: '8a',     label: '8(a)' },
  { value: 'hubzone',label: 'HUBZone' },
  { value: 'wosb',   label: 'WOSB' },
  { value: 'sdvosb', label: 'SDVOSB' },
  { value: 'sba',    label: 'Small Business' },
  { value: 'none',   label: 'None' },
];

const OPP_TYPE_OPTS = [
  { value: 'Solicitation',           label: 'Solicitation' },
  { value: 'Presolicitation',        label: 'Presolicitation' },
  { value: 'Special Notice',         label: 'Special Notice' },
  { value: 'Synopsis Solicitation',  label: 'Synopsis Solicitation' },
  { value: 'Posted',                 label: 'Posted' },
];
