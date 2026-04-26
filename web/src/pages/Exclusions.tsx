import * as React from 'react';
import { motion } from 'framer-motion';
import { Search, X, ShieldAlert } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Input, Label, Select } from '@/components/ui/Input';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
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
import { fmtDate, fmtInt } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface Exclusion {
  exclusion_id: string;
  uei: string | null;
  legal_name: string | null;
  classification: string | null;
  exclusion_type: string | null;
  excluding_agency: string | null;
  active_date: string | null;
  termination_date: string | null;
  is_active: number;
  state: string | null;
  country_code: string | null;
}

export function ExclusionsPage() {
  const viewQuery = useViewQuery();
  const { active: activeView, loading: viewsLoading } = useViews();
  const [q, setQ] = React.useState('');
  const [activeFilter, setActiveFilter] = React.useState<'true' | 'false'>('true');
  const [token, setToken] = React.useState(0);
  const [rows, setRows] = React.useState<Exclusion[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (viewsLoading || !activeView) return;
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: Exclusion[] }>('/exclusions', {
          ...viewQuery,
          q: q || undefined,
          active: activeFilter,
          limit: 200,
        });
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [token, activeFilter, viewQuery?.view_id, viewsLoading, activeView]);

  if (!viewsLoading && !activeView) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Exclusions"
          description="SAM.gov exclusions for vendors that appear in this view's awards."
        />
        <NoViewSelected pageLabel="exclusions" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Explore"
        title="Exclusions"
        description="SAM.gov exclusions list — debarments, suspensions, and other restrictions on federal procurement."
      />

      <Card>
        <form
          onSubmit={(e) => { e.preventDefault(); setToken((n) => n + 1); }}
          className="grid gap-3 p-6 md:grid-cols-[1.4fr_220px_auto]"
        >
          <div>
            <Label>Vendor name / UEI</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                className="pl-10"
                placeholder="Search…"
              />
            </div>
          </div>
          <div>
            <Label>Status</Label>
            <Select
              value={activeFilter}
              onChange={(e) => setActiveFilter(e.target.value as 'true' | 'false')}
            >
              <option value="true">Active only</option>
              <option value="false">All (incl. terminated)</option>
            </Select>
          </div>
          <div className="flex items-end gap-2">
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
            <EmptyState>
              <ShieldAlert className="mx-auto mb-2 h-6 w-6 text-brand-sage" />
              No exclusions match.
            </EmptyState>
          ) : (
            <>
              <div className="border-b border-border px-4 py-3 text-xs text-muted">
                <span className="font-bold text-foreground">{fmtInt(rows.length)}</span> exclusions
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Entity</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Excluding agency</TableHead>
                    <TableHead className="text-right">Active</TableHead>
                    <TableHead className="text-right">Terminates</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.exclusion_id}>
                      <TableCell className="max-w-[280px]">
                        <div className="truncate font-medium text-foreground">
                          {r.legal_name ?? '—'}
                        </div>
                        <div className="font-mono text-[11px] text-muted-soft">
                          {r.uei ?? '—'}{r.state ? ` · ${r.state}` : ''}
                          {r.country_code ? ` · ${r.country_code}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="text-muted">
                        <div>{r.classification ?? '—'}</div>
                        <div className="text-[11px] text-muted-soft">
                          {r.exclusion_type ?? '—'}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted">
                        {r.excluding_agency ?? '—'}
                      </TableCell>
                      <TableCell className="text-right text-muted">
                        {fmtDate(r.active_date)}
                      </TableCell>
                      <TableCell className="text-right text-muted">
                        {fmtDate(r.termination_date)}
                      </TableCell>
                      <TableCell>
                        {r.is_active ? (
                          <Badge variant="danger">Active</Badge>
                        ) : (
                          <Badge variant="ghost">Terminated</Badge>
                        )}
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
