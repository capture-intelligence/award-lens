import * as React from 'react';
import { motion } from 'framer-motion';
import { Search, X } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input, Label } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
  EmptyState,
} from '@/components/ui/Table';
import { TableSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { useViewQuery, useViews } from '@/lib/view-context';
import { NoViewSelected } from '@/components/ui/NoViewSelected';
import { fmtMoney, fmtDate, fmtInt } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface Vendor {
  vendor_id: string;
  uei: string | null;
  legal_name: string | null;
  num_awards: number;
  total_value: number;
  first_award_date: string | null;
  last_pop_end: string | null;
}

export function VendorsPage() {
  const viewQuery = useViewQuery();
  const { active, loading: viewsLoading } = useViews();
  const [q, setQ] = React.useState('');
  const [token, setToken] = React.useState(0);
  const [rows, setRows] = React.useState<Vendor[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (viewsLoading || !active) return;
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: Vendor[] }>('/vendors', {
          ...viewQuery,
          q: q || undefined,
          limit: 200,
        });
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load vendors');
      }
    })();
    return () => { alive = false; };
  }, [token, viewQuery?.view_id, viewsLoading, active]);

  if (!viewsLoading && !active) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Vendors"
          description="Aggregated vendor activity, scoped to a single view."
        />
        <NoViewSelected pageLabel="vendors" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Explore"
        title="Vendors"
        description="Aggregated vendor activity. Click a row to view classifications and top awards."
      />

      <Card>
        <form
          onSubmit={(e) => { e.preventDefault(); setToken((n) => n + 1); }}
          className="flex flex-col gap-3 p-6 sm:flex-row sm:items-end"
        >
          <div className="flex-1">
            <Label>Vendor name</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-10"
                placeholder="Legal name contains…"
              />
            </div>
          </div>
          <div className="flex gap-2">
            <Button type="submit" variant="primary">Search</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setQ(''); setToken((n) => n + 1); }}
            >
              <X className="mr-1 h-4 w-4" /> Clear
            </Button>
          </div>
        </form>
      </Card>

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          {rows === null ? (
            <TableSkeleton rows={10} />
          ) : rows.length === 0 ? (
            <EmptyState>No vendors match your search.</EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs text-muted">
                <span>
                  Showing <span className="font-bold text-foreground">{fmtInt(rows.length)}</span> vendors
                </span>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Vendor</TableHead>
                    <TableHead>UEI</TableHead>
                    <TableHead className="text-right">Awards</TableHead>
                    <TableHead className="text-right">Total value</TableHead>
                    <TableHead className="text-right">First / last</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.vendor_id}>
                      <TableCell className="max-w-[320px] truncate font-medium text-foreground">
                        {r.legal_name ?? '—'}
                      </TableCell>
                      <TableCell className="font-mono text-xs text-muted">
                        {r.uei ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted">
                        {fmtInt(r.num_awards)}
                      </TableCell>
                      <TableCell className="text-right font-mono text-brand-vermilion-soft">
                        {fmtMoney(r.total_value)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted">
                        {fmtDate(r.first_award_date)} → {fmtDate(r.last_pop_end)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
