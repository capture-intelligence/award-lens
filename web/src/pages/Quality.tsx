import * as React from 'react';
import { motion } from 'framer-motion';
import { Activity, AlertTriangle, CheckCircle2, HelpCircle } from 'lucide-react';
import { Card, Stat } from '@/components/ui/Card';
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
import { TableSkeleton, StatSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { fmtDate, fmtMoney, fmtInt } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface Summary {
  last_check: string | null;
  ok_count: number;
  drift_count: number;
  error_count: number;
  no_data_count: number;
}

interface Check {
  dimension_type: string;
  dimension_value: string;
  fiscal_year: number;
  warehouse_total: number | null;
  source_total: number | null;
  drift_abs: number | null;
  drift_pct: number | null;
  status: 'ok' | 'drift' | 'error' | 'no_data';
  notes: string | null;
  check_date: string | null;
}

export function QualityPage() {
  const [summary, setSummary] = React.useState<Summary | null>(null);
  const [checks, setChecks] = React.useState<Check[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [s, l] = await Promise.all([
          api.get<Summary>('/reconciliation/summary'),
          api.get<{ results: Check[] }>('/reconciliation/latest'),
        ]);
        if (!alive) return;
        setSummary(s);
        setChecks(l.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, []);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operate"
        title="Data quality"
        description="Reconciliation between the warehouse and upstream sources, segmented by dimension and fiscal year."
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {summary === null ? (
          <>
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
          </>
        ) : (
          <>
            <Stat label="In sync"  value={fmtInt(summary.ok_count)}      icon={CheckCircle2}   accent="sage" />
            <Stat label="Drift"    value={fmtInt(summary.drift_count)}   icon={AlertTriangle}  accent="vermilion" />
            <Stat label="Error"    value={fmtInt(summary.error_count)}   icon={Activity}       accent="warning" />
            <Stat label="No data"  value={fmtInt(summary.no_data_count)} icon={HelpCircle}     accent="muted" />
          </>
        )}
      </section>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
                Most recent
              </div>
              <h2 className="text-lg font-bold tracking-tight">Latest reconciliation results</h2>
            </div>
            {summary?.last_check && (
              <div className="text-xs text-muted">
                As of <span className="font-mono text-foreground">{fmtDate(summary.last_check)}</span>
              </div>
            )}
          </div>
          {checks === null ? (
            <TableSkeleton rows={10} />
          ) : checks.length === 0 ? (
            <EmptyState>No reconciliation results yet.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Dimension</TableHead>
                  <TableHead>FY</TableHead>
                  <TableHead className="text-right">Warehouse</TableHead>
                  <TableHead className="text-right">Source</TableHead>
                  <TableHead className="text-right">Drift</TableHead>
                  <TableHead>Status</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {checks.map((r, i) => (
                  <TableRow key={`${r.dimension_value}-${r.fiscal_year}-${i}`}>
                    <TableCell className="max-w-[280px]">
                      <div className="truncate font-medium text-foreground">{r.dimension_value}</div>
                      <div className="text-[11px] text-muted-soft">{r.dimension_type}</div>
                    </TableCell>
                    <TableCell className="text-muted">{r.fiscal_year}</TableCell>
                    <TableCell className="text-right font-mono text-foreground">
                      {fmtMoney(r.warehouse_total)}
                    </TableCell>
                    <TableCell className="text-right font-mono text-muted">
                      {fmtMoney(r.source_total)}
                    </TableCell>
                    <TableCell className="text-right">
                      <div className="font-mono">
                        {r.drift_pct != null ? `${r.drift_pct.toFixed(2)}%` : '—'}
                      </div>
                      <div className="font-mono text-[11px] text-muted-soft">
                        {fmtMoney(r.drift_abs)}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Badge
                        variant={
                          r.status === 'ok'      ? 'success' :
                          r.status === 'drift'   ? 'danger'  :
                          r.status === 'error'   ? 'warning' : 'info'
                        }
                      >
                        {r.status}
                      </Badge>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
