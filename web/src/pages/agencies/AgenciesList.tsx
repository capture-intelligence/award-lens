import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Landmark } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { fmtMoney } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * Federal Agencies — list view.
 *
 * Wired to GET /organizations (workers/api), which returns every awarding
 * organization in the warehouse with its award count and total obligated
 * value. The endpoint returns the full set (~20 orgs) and has no server-side
 * search, so the keyword box filters the fetched rows client-side. Rows are
 * not linked yet — the agency detail page is still a stub, and linking to it
 * would look broken.
 */

interface OrgRow {
  org_id: string;
  canonical_name: string;
  short_name: string | null;
  org_type: string | null;
  num_awards: number;
  total_value: number;
}

export function AgenciesListPage() {
  const [filters, setFilters] = React.useState<FilterState>({ quick: {}, search: {} });
  const [rows, setRows] = React.useState<OrgRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    api
      .get<{ count: number; results: OrgRow[] }>('/organizations')
      .then((d) => { if (alive) setRows(d.results ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  const q = ((filters.search?.q as { kind: 'text'; value: string } | undefined)?.value ?? '').trim().toLowerCase();
  const visible = React.useMemo(
    () => (q ? rows.filter((r) => (r.canonical_name ?? '').toLowerCase().includes(q) || (r.short_name ?? '').toLowerCase().includes(q)) : rows),
    [rows, q],
  );

  const columns = React.useMemo<ColumnDef<OrgRow, unknown>[]>(() => [
    {
      accessorKey: 'canonical_name',
      header: 'Name',
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft">
            <Landmark className="h-3.5 w-3.5" />
          </span>
          <span>
            {row.original.canonical_name}
            {row.original.short_name && <span className="ml-2 text-[11px] text-muted-soft">{row.original.short_name}</span>}
          </span>
        </span>
      ),
      meta: { minWidth: 340 },
    },
    { accessorKey: 'org_type', header: 'Type', cell: ({ row }) => <span className="text-muted">{row.original.org_type ?? '—'}</span> },
    { accessorKey: 'num_awards', header: 'Awards', cell: ({ row }) => <span className="tabular-nums">{(row.original.num_awards ?? 0).toLocaleString()}</span>, meta: { numeric: true } },
    { accessorKey: 'total_value', header: 'Total value', cell: ({ row }) => fmtMoney(row.original.total_value), meta: { numeric: true, minWidth: 140 } },
  ], []);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Federal Agencies"
        description="Awarding organizations in the warehouse, ranked by total obligated value."
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {loading ? 'Loading…' : `${visible.length.toLocaleString()} shown`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[]}
          searchFilters={[{ id: 'q', label: 'Search by name', type: 'text' }]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <DataTable<OrgRow>
          columns={columns}
          data={visible}
          totalCount={visible.length}
          ariaLabel="Federal agencies"
          columnVisibilityStorageKey="captureradar.agencies.cols"
        />
      </div>
    </div>
  );
}
