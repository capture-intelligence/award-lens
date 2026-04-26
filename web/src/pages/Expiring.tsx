import * as React from 'react';
import { motion } from 'framer-motion';
import { Card } from '@/components/ui/Card';
import { Label, Select } from '@/components/ui/Input';
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
import { fmtMoney, fmtDate, fmtInt } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface Award {
  award_id: string;
  award_piid: string | null;
  description: string | null;
  current_value: number | null;
  pop_end_date: string | null;
  vendor_name: string | null;
  awarding_org_name: string | null;
  days_to_expiry: number | null;
}

const WINDOWS = [3, 6, 12, 18, 24, 36] as const;
type Window = (typeof WINDOWS)[number];

export function ExpiringPage() {
  const viewQuery = useViewQuery();
  const { active, loading: viewsLoading } = useViews();
  const [months, setMonths] = React.useState<Window>(18);
  const [rows, setRows] = React.useState<Award[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (viewsLoading || !active) return;
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: Award[] }>(`/awards/expiring/${months}`, viewQuery);
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [months, viewQuery?.view_id, viewsLoading, active]);

  if (!viewsLoading && !active) {
    return (
      <div className="space-y-6">
        <PageHeader
          eyebrow="Explore"
          title="Expiring soon"
          description="Awards whose period of performance ends within the selected window — scoped to a view."
        />
        <NoViewSelected pageLabel="expiring awards" />
      </div>
    );
  }

  const totalValue = React.useMemo(
    () => (rows ?? []).reduce((s, r) => s + (r.current_value ?? 0), 0),
    [rows],
  );

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Explore"
        title="Expiring soon"
        description="Awards whose period of performance ends within the selected window. Useful for re-compete planning."
        actions={
          <div className="flex items-end gap-3">
            <div>
              <Label>Window</Label>
              <Select
                value={String(months)}
                onChange={(e) => setMonths(Number(e.target.value) as Window)}
              >
                {WINDOWS.map((m) => (
                  <option key={m} value={m}>{m} months</option>
                ))}
              </Select>
            </div>
          </div>
        }
      />

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
            <EmptyState>Nothing expires in the selected window.</EmptyState>
          ) : (
            <>
              <div className="flex items-center justify-between border-b border-border px-4 py-3 text-xs">
                <div className="text-muted">
                  <span className="font-bold text-foreground">{fmtInt(rows.length)}</span> awards
                </div>
                <div className="text-muted">
                  Combined value{' '}
                  <span className="font-bold text-brand-vermilion-soft">{fmtMoney(totalValue)}</span>
                </div>
              </div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Description</TableHead>
                    <TableHead>Vendor</TableHead>
                    <TableHead>Agency</TableHead>
                    <TableHead className="text-right">Value</TableHead>
                    <TableHead className="text-right">Ends</TableHead>
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
                          {r.award_piid ?? r.award_id}
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
                      <TableCell className="text-right">
                        <div className="text-foreground">{fmtDate(r.pop_end_date)}</div>
                        {typeof r.days_to_expiry === 'number' && (
                          <Badge
                            variant={
                              r.days_to_expiry < 90 ? 'danger' :
                              r.days_to_expiry < 180 ? 'warning' : 'info'
                            }
                            className="mt-1"
                          >
                            {r.days_to_expiry} d
                          </Badge>
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
