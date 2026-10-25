import * as React from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * Federal Awardees — list view.
 *
 * Wired to GET /vendors (workers/api → v_vendor_rollup). The columns show
 * only what that rollup actually contains: identity (name, UEI) and award
 * history (count, total obligated value, last period-of-performance end).
 * The investor-demo columns that ran on fabricated data (CAGE, HQ city/
 * state, founded year) and the filters with no server backing (set-aside
 * certifications, NAICS, founded range) are intentionally not shown — the
 * keyword search below is real and hits the API.
 */

interface VendorRow {
  vendor_id: string;
  uei: string | null;
  legal_name: string;
  num_awards: number;
  total_value: number;
  first_award_date: string | null;
  last_pop_end: string | null;
}

export function AwardeesListPage() {
  const [filters, setFilters] = React.useState<FilterState>({ quick: {}, search: {} });
  const [rows, setRows] = React.useState<VendorRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  // Keyword lives in the filter panel's `q` text field; debounce it so each
  // keystroke doesn't fire a query.
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
      .get<{ count: number; results: VendorRow[] }>('/vendors', {
        limit: '200',
        ...(debouncedQ ? { q: debouncedQ } : {}),
      })
      .then((d) => { if (alive) setRows(d.results ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debouncedQ]);

  const columns = React.useMemo<ColumnDef<VendorRow, unknown>[]>(() => [
    {
      accessorKey: 'legal_name',
      header: 'Name',
      cell: ({ row }) => (
        <Link to={`/awardee/${row.original.vendor_id}`} className="flex items-center gap-2 font-medium text-foreground hover:text-brand-vermilion-soft hover:underline">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          {row.original.legal_name}
        </Link>
      ),
      meta: { minWidth: 320 },
    },
    { accessorKey: 'uei', header: 'UEI', cell: ({ row }) => <span className="text-muted tabular-nums">{row.original.uei ?? '—'}</span>, meta: { minWidth: 130 } },
    { accessorKey: 'num_awards', header: 'Awards', cell: ({ row }) => <span className="tabular-nums">{row.original.num_awards.toLocaleString()}</span>, meta: { numeric: true } },
    { accessorKey: 'total_value', header: 'Total value', cell: ({ row }) => fmtMoney(row.original.total_value), meta: { numeric: true, minWidth: 140 } },
    { accessorKey: 'last_pop_end', header: 'Last activity', cell: ({ row }) => (row.original.last_pop_end ? fmtDate(row.original.last_pop_end) : '—'), meta: { minWidth: 120 } },
  ], []);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Federal Awardees"
        description="Vendors in the warehouse, ranked by total obligated value across their award history."
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {loading ? 'Loading…' : `${rows.length.toLocaleString()} shown`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[]}
          searchFilters={[
            { id: 'q', label: 'Search by name', type: 'text' },
          ]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <DataTable<VendorRow>
          columns={columns}
          data={rows}
          totalCount={rows.length}
          ariaLabel="Federal awardees"
          columnVisibilityStorageKey="captureradar.awardees.cols"
        />
      </div>
    </div>
  );
}
