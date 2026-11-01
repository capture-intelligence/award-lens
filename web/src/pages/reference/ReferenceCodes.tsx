import * as React from 'react';
import { type ColumnDef } from '@tanstack/react-table';
import { Tag } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { fmtMoney } from '@/lib/utils';
import { api } from '@/lib/api';

/**
 * NAICS / PSC reference — the codes observed in the warehouse's awards, with
 * their description and award count/value. Wired to GET /ref/naics and
 * /ref/psc (workers/api). The endpoint returns the full set (≤500), so the
 * keyword box filters client-side. Null-safe.
 */

interface CodeRow {
  code: string | null;
  description: string | null;
  num_awards: number;
  total_value: number;
}

function ReferenceCodesPage({ endpoint, title, codeLabel }: { endpoint: 'naics' | 'psc'; title: string; codeLabel: string }) {
  const [filters, setFilters] = React.useState<FilterState>({ quick: {}, search: {} });
  const [rows, setRows] = React.useState<CodeRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<{ count: number; results: CodeRow[] }>(`/ref/${endpoint}`)
      .then((d) => { if (alive) setRows(d.results ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [endpoint]);

  const q = ((filters.search?.q as { kind: 'text'; value: string } | undefined)?.value ?? '').trim().toLowerCase();
  const visible = React.useMemo(
    () => (q ? rows.filter((r) => (r.code ?? '').toLowerCase().includes(q) || (r.description ?? '').toLowerCase().includes(q)) : rows),
    [rows, q],
  );

  const columns = React.useMemo<ColumnDef<CodeRow, unknown>[]>(() => [
    {
      accessorKey: 'code',
      header: codeLabel,
      cell: ({ row }) => (
        <span className="flex items-center gap-2 font-medium text-foreground">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft"><Tag className="h-3.5 w-3.5" /></span>
          <span className="tabular-nums">{row.original.code ?? '—'}</span>
        </span>
      ),
      meta: { minWidth: 120 },
    },
    { accessorKey: 'description', header: 'Description', cell: ({ row }) => <span className="text-muted">{row.original.description ?? '—'}</span>, meta: { minWidth: 360 } },
    { accessorKey: 'num_awards', header: 'Awards', cell: ({ row }) => <span className="tabular-nums">{(row.original.num_awards ?? 0).toLocaleString()}</span>, meta: { numeric: true } },
    { accessorKey: 'total_value', header: 'Total value', cell: ({ row }) => fmtMoney(row.original.total_value), meta: { numeric: true, minWidth: 130 } },
  ], [codeLabel]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Reference"
        title={title}
        description={`${codeLabel} codes represented in the warehouse's contract awards, ranked by award count.`}
      />
      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {loading ? 'Loading…' : `${visible.length.toLocaleString()} codes`}
        </span>
      </div>
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[]}
          searchFilters={[{ id: 'q', label: `Search ${codeLabel}`, type: 'text' }]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <DataTable<CodeRow>
          columns={columns}
          data={visible}
          totalCount={visible.length}
          ariaLabel={`${codeLabel} codes`}
          columnVisibilityStorageKey={`captureradar.${endpoint}.cols`}
        />
      </div>
    </div>
  );
}

export function NaicsPage() { return <ReferenceCodesPage endpoint="naics" title="NAICS Codes" codeLabel="NAICS" />; }
export function PscPage() { return <ReferenceCodesPage endpoint="psc" title="PSC Codes" codeLabel="PSC" />; }
