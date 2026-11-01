import * as React from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Award as AwardIcon } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * Federal Contract Awards — list view.
 *
 * Wired to GET /awards (workers/api → v_award_current, USAspending prime
 * awards), highest-value / latest-ending first, with real server-side keyword
 * search. Rows aren't linked yet — the per-award detail panel needs the full
 * decorated award shape (see the Explore page), which this lighter list
 * endpoint doesn't return; wiring the detail is a follow-up.
 */

interface AwardRow {
  award_id: string;
  award_piid: string | null;
  award_type: string | null;
  current_value: number | null;
  pop_end_date: string | null;
  awarding_org_name: string | null;
  vendor_name: string | null;
}

export function ContractAwardsListPage() {
  const [filters, setFilters] = React.useState<FilterState>({ quick: {}, search: {} });
  const [rows, setRows] = React.useState<AwardRow[]>([]);
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
      .get<{ count: number; results: AwardRow[] }>('/awards', {
        limit: '200',
        ...(debouncedQ ? { q: debouncedQ } : {}),
      })
      .then((d) => { if (alive) setRows(d.results ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debouncedQ]);

  const columns = React.useMemo<ColumnDef<AwardRow, unknown>[]>(() => [
    {
      accessorKey: 'award_piid',
      header: 'Award',
      cell: ({ row }) => (
        <Link to={`/award/contract/prime/${row.original.award_id}`} className="group flex items-start gap-2 font-medium text-foreground hover:text-brand-vermilion-soft">
          <span className="mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft group-hover:text-brand-vermilion-soft">
            <AwardIcon className="h-3.5 w-3.5" />
          </span>
          <span>
            <span className="tabular-nums">{row.original.award_piid ?? row.original.award_id}</span>
            {row.original.award_type && <span className="ml-2 text-[11px] capitalize text-muted-soft">{row.original.award_type.toLowerCase()}</span>}
          </span>
        </Link>
      ),
      meta: { minWidth: 260 },
    },
    { accessorKey: 'vendor_name', header: 'Vendor', cell: ({ row }) => <span className="text-foreground">{row.original.vendor_name ?? '—'}</span>, meta: { minWidth: 220 } },
    { accessorKey: 'awarding_org_name', header: 'Agency', cell: ({ row }) => <span className="text-muted">{row.original.awarding_org_name ?? '—'}</span>, meta: { minWidth: 200 } },
    { accessorKey: 'current_value', header: 'Value', cell: ({ row }) => (row.original.current_value != null ? fmtMoney(row.original.current_value) : '—'), meta: { numeric: true, minWidth: 130 } },
    { accessorKey: 'pop_end_date', header: 'Ends', cell: ({ row }) => (row.original.pop_end_date ? fmtDate(row.original.pop_end_date) : '—'), meta: { minWidth: 120 } },
  ], []);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Federal Contract Awards"
        description="Prime contract awards in the warehouse (USAspending), highest value and latest period-of-performance first."
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {loading ? 'Loading…' : `${rows.length.toLocaleString()} shown`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[]}
          searchFilters={[{ id: 'q', label: 'Search awards', type: 'text' }]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <DataTable<AwardRow>
          columns={columns}
          data={rows}
          totalCount={rows.length}
          ariaLabel="Federal contract awards"
          columnVisibilityStorageKey="captureradar.contractawards.cols"
        />
      </div>
    </div>
  );
}
