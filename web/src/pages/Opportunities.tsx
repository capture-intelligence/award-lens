import * as React from 'react';
import { motion } from 'framer-motion';
import { Search, X, ExternalLink } from 'lucide-react';
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
import { fmtDate, fmtInt, fmtMoney } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface Opportunity {
  opportunity_id: string;
  opportunity_number: string | null;
  title: string | null;
  agency_code: string | null;
  agency_name: string | null;
  status: string | null;
  posted_date: string | null;
  close_date: string | null;
  est_total_funding: number | null;
  award_ceiling: number | null;
  award_floor: number | null;
  expected_awards: number | null;
  assistance_listings: string | null;
  opportunity_url: string | null;
  days_to_close: number | null;
}

export function OpportunitiesPage() {
  const viewQuery = useViewQuery();
  const { active: activeView, loading: viewsLoading } = useViews();
  const [q, setQ] = React.useState('');
  const [agency, setAgency] = React.useState('');
  const [status, setStatus] = React.useState('posted');
  const [activeOnly, setActiveOnly] = React.useState('true');
  const [token, setToken] = React.useState(0);
  const [rows, setRows] = React.useState<Opportunity[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (viewsLoading || !activeView) return;
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: Opportunity[] }>('/opportunities', {
          ...viewQuery,
          q: q || undefined,
          agency: agency || undefined,
          status,
          active: activeOnly,
          limit: 200,
        });
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [token, status, activeOnly, viewQuery?.view_id, viewsLoading, activeView]);

  if (!viewsLoading && !activeView) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Opportunities"
          description="Open Grants.gov listings from agencies in this view's scope."
        />
        <NoViewSelected pageLabel="opportunities" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Explore"
        title="Opportunities"
        description="Open Grants.gov assistance listings — synced nightly."
      />

      <Card>
        <form
          onSubmit={(e) => { e.preventDefault(); setToken((n) => n + 1); }}
          className="grid gap-3 p-6 md:grid-cols-[1.4fr_1fr_180px_180px_auto]"
        >
          <div>
            <Label>Title / number / description</Label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" />
              <Input value={q} onChange={(e) => setQ(e.target.value)} className="pl-10" placeholder="Search…" />
            </div>
          </div>
          <div>
            <Label>Agency code</Label>
            <Input value={agency} onChange={(e) => setAgency(e.target.value)} placeholder="e.g. HHS" />
          </div>
          <div>
            <Label>Status</Label>
            <Select value={status} onChange={(e) => setStatus(e.target.value)}>
              <option value="posted">Posted</option>
              <option value="forecasted">Forecasted</option>
              <option value="closed">Closed</option>
              <option value="any">Any</option>
            </Select>
          </div>
          <div>
            <Label>Active only</Label>
            <Select value={activeOnly} onChange={(e) => setActiveOnly(e.target.value)}>
              <option value="true">Yes</option>
              <option value="false">Show closed</option>
            </Select>
          </div>
          <div className="flex items-end gap-2">
            <Button type="submit" variant="primary">Search</Button>
            <Button
              type="button"
              variant="ghost"
              onClick={() => { setQ(''); setAgency(''); setToken((n) => n + 1); }}
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
            <EmptyState>No opportunities match.</EmptyState>
          ) : (
            <>
              <div className="border-b border-border px-4 py-3 text-xs text-muted">
                <span className="font-bold text-foreground">{fmtInt(rows.length)}</span> opportunities
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Title</TableHead>
                    <TableHead>Agency</TableHead>
                    <TableHead className="text-right">Funding</TableHead>
                    <TableHead className="text-right">Closes</TableHead>
                    <TableHead></TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {rows.map((r) => (
                    <TableRow key={r.opportunity_id}>
                      <TableCell className="max-w-[420px]">
                        <div className="truncate font-medium text-foreground">{r.title ?? '—'}</div>
                        <div className="text-[11px] text-muted-soft">
                          {r.opportunity_number ?? '—'}
                          {r.assistance_listings ? ` · CFDA ${r.assistance_listings}` : ''}
                        </div>
                      </TableCell>
                      <TableCell className="max-w-[200px] truncate text-muted">
                        <div>{r.agency_name ?? '—'}</div>
                        <div className="text-[11px] text-muted-soft">{r.agency_code ?? ''}</div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="font-mono text-brand-vermilion-soft">
                          {fmtMoney(r.est_total_funding)}
                        </div>
                        {r.expected_awards ? (
                          <div className="text-[11px] text-muted-soft">
                            ~{r.expected_awards} awards
                          </div>
                        ) : null}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="text-foreground">{fmtDate(r.close_date)}</div>
                        {typeof r.days_to_close === 'number' && r.days_to_close >= 0 && (
                          <Badge
                            variant={
                              r.days_to_close < 7 ? 'danger' :
                              r.days_to_close < 30 ? 'warning' : 'info'
                            }
                            className="mt-1"
                          >
                            {r.days_to_close} d
                          </Badge>
                        )}
                      </TableCell>
                      <TableCell>
                        {r.opportunity_url && (
                          <a
                            href={r.opportunity_url}
                            target="_blank"
                            rel="noreferrer"
                            className="inline-flex items-center gap-1 text-xs text-brand-sage hover:text-foreground"
                          >
                            View <ExternalLink className="h-3 w-3" />
                          </a>
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
