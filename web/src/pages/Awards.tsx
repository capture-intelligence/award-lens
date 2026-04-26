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

interface Award {
  award_id: string;
  award_piid: string | null;
  award_type: string | null;
  description: string | null;
  current_value: number | null;
  pop_end_date: string | null;
  vendor_name: string | null;
  awarding_org_name: string | null;
  days_to_expiry: number | null;
}

export function AwardsPage() {
  const viewQuery = useViewQuery();
  const { active, loading: viewsLoading } = useViews();
  const [q, setQ] = React.useState('');
  const [vendor, setVendor] = React.useState('');
  const [org, setOrg] = React.useState('');
  const [minValue, setMinValue] = React.useState('');
  const [rows, setRows] = React.useState<Award[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [searchToken, setSearchToken] = React.useState(0);

  React.useEffect(() => {
    if (viewsLoading || !active) return;
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: Award[] }>('/awards', {
          ...viewQuery,
          q: q || undefined,
          vendor: vendor || undefined,
          awarding_org: org || undefined,
          min_value: minValue ? Number(minValue) : undefined,
          limit: 200,
        });
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load awards');
      }
    })();
    return () => { alive = false; };
  }, [searchToken, viewQuery?.view_id, viewsLoading, active]);

  if (!viewsLoading && !active) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Awards"
          description="Replicated contract and assistance awards, scoped to a single view."
        />
        <NoViewSelected pageLabel="awards" />
      </div>
    );
  }

  const onSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setSearchToken((n) => n + 1);
  };

  const onClear = () => {
    setQ(''); setVendor(''); setOrg(''); setMinValue('');
    setSearchToken((n) => n + 1);
  };

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Explore"
        title="Awards"
        description="Replicated contract and assistance awards. Filter by description, vendor, awarding agency, or minimum value."
      />

      <Card>
        <form onSubmit={onSubmit} className="grid gap-4 p-6 md:grid-cols-[1.4fr_1fr_1fr_0.8fr_auto]">
          <div>
            <Label>Description / PIID</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-10"
                placeholder="e.g. statistical analysis"
              />
            </div>
          </div>
          <div>
            <Label>Vendor name</Label>
            <Input value={vendor} onChange={(e) => setVendor(e.target.value)} placeholder="contains…" />
          </div>
          <div>
            <Label>Awarding agency</Label>
            <Input value={org} onChange={(e) => setOrg(e.target.value)} placeholder="contains…" />
          </div>
          <div>
            <Label>Min value (USD)</Label>
            <Input
              type="number"
              inputMode="numeric"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              placeholder="0"
            />
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary">Search</Button>
            <Button type="button" variant="ghost" onClick={onClear}>
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
            <EmptyState>No awards match the current filters.</EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3">
                <div className="text-xs text-muted">
                  Showing <span className="font-bold text-foreground">{fmtInt(rows.length)}</span> awards
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Agency</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">PoP end</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.award_id}>
                      <TableCell className="max-w-[420px]">
                        <div className="truncate font-medium text-foreground">
                          {r.description ?? '—'}
                        </div>
                        <div className="text-[11px] text-muted-soft">
                          {r.award_piid ?? r.award_id} · {r.award_type ?? 'unknown'}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate text-muted">
                        {r.vendor_name ?? '—'}
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted">
                        {r.awarding_org_name ?? '—'}
                      </TableCell>
                      <TableCell className="text-right font-mono text-brand-vermilion-soft">
                        {fmtMoney(r.current_value)}
                      </TableCell>
                      <TableCell className="text-right text-muted">
                        {fmtDate(r.pop_end_date)}
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
