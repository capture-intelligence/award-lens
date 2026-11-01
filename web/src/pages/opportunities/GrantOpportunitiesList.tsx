import * as React from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { BookOpen } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * Federal Grant Opportunities — list view.
 *
 * Wired to GET /opportunities (workers/api → grant_opportunity, sourced from
 * Grants.gov and refreshed daily). Shows open ("posted", not past close date)
 * opportunities soonest-closing first. The endpoint supports server-side
 * keyword search, which the search box uses. grants.gov data is sparse on some
 * fields (agency_name, funding, close date), so those render "—" when absent.
 * Titles link out to the Grants.gov posting (the authoritative source); the
 * in-app grant detail page is still a stub.
 */

interface GrantRow {
  opportunity_id: string;
  opportunity_number: string | null;
  title: string;
  agency_code: string | null;
  agency_name: string | null;
  status: string | null;
  posted_date: string | null;
  close_date: string | null;
  est_total_funding: number | null;
  opportunity_url: string | null;
  days_to_close: number | null;
}

export function GrantOpportunitiesListPage() {
  const [filters, setFilters] = React.useState<FilterState>({ quick: {}, search: {} });
  const [rows, setRows] = React.useState<GrantRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const q = (filters.search?.q as { kind: 'text'; value: string } | undefined)?.value ?? '';
  const [debouncedQ, setDebouncedQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<{ count: number; results: GrantRow[] }>('/opportunities', {
        active: 'true',
        limit: '500',
        ...(debouncedQ ? { q: debouncedQ } : {}),
      })
      .then((d) => { if (alive) setRows(d.results ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debouncedQ]);

  const columns = React.useMemo<ColumnDef<GrantRow, unknown>[]>(() => [
    {
      accessorKey: 'title',
      header: 'Title',
      cell: ({ row }) => (
        <Link to={`/opportunity/grant/${row.original.opportunity_id}`} className="group flex items-start gap-2 font-medium text-foreground hover:text-brand-vermilion-soft">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft group-hover:text-brand-vermilion-soft">
            <BookOpen className="h-3.5 w-3.5" />
          </span>
          <span className="line-clamp-2">{row.original.title}</span>
        </Link>
      ),
      meta: { minWidth: 360 },
    },
    { accessorKey: 'opportunity_number', header: 'Number', cell: ({ row }) => <span className="text-muted tabular-nums">{row.original.opportunity_number ?? '—'}</span>, meta: { minWidth: 130 } },
    { accessorKey: 'agency_name', header: 'Agency', cell: ({ row }) => <span className="text-muted">{row.original.agency_name ?? row.original.agency_code ?? '—'}</span>, meta: { minWidth: 160 } },
    { accessorKey: 'status', header: 'Status', cell: ({ row }) => <span className="capitalize text-muted">{row.original.status ?? '—'}</span> },
    { accessorKey: 'est_total_funding', header: 'Est. funding', cell: ({ row }) => (row.original.est_total_funding != null ? fmtMoney(row.original.est_total_funding) : '—'), meta: { numeric: true, minWidth: 130 } },
    {
      accessorKey: 'close_date',
      header: 'Closes',
      cell: ({ row }) => {
        const o = row.original;
        if (!o.close_date) return <span className="text-muted-soft">—</span>;
        const soon = o.days_to_close != null && o.days_to_close >= 0 && o.days_to_close <= 14;
        return (
          <span className="inline-flex items-center gap-2">
            {fmtDate(o.close_date)}
            {soon && <span className="rounded-full bg-brand-vermilion/15 px-1.5 py-px text-[10px] font-bold text-brand-vermilion-soft">{o.days_to_close}d</span>}
          </span>
        );
      },
      meta: { minWidth: 140 },
    },
  ], []);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Business Development"
        title="Federal Grant Opportunities"
        description="Open federal grant opportunities from Grants.gov, refreshed daily and sorted soonest-closing first."
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {loading ? 'Loading…' : `${rows.length.toLocaleString()} open`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[]}
          searchFilters={[{ id: 'q', label: 'Search grants', type: 'text' }]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <DataTable<GrantRow>
          columns={columns}
          data={rows}
          totalCount={rows.length}
          ariaLabel="Federal grant opportunities"
          columnVisibilityStorageKey="captureradar.grants.cols"
        />
      </div>
    </div>
  );
}
