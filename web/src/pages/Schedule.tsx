import * as React from 'react';
import { motion } from 'framer-motion';
import { CalendarRange, RefreshCw } from 'lucide-react';
import { Card, Stat } from '@/components/ui/Card';
import { StatusBadge } from '@/components/ui/Badge';
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
import { TableSkeleton, StatSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtInt, relativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface LastRun {
  run_id: number;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_upserted: number;
  rows_fetched: number;
}

interface ScheduleRow {
  source_id: string;
  display_name: string;
  cron: string;
  interval_human: string;
  enabled: boolean;
  stale_threshold_hours: number;
  last_run: LastRun | null;
  currently_running: boolean;
  next_run_estimated: string | null;
  hours_since_last_run: number | null;
  health: 'healthy' | 'stale' | 'running' | 'never_run' | 'error' | 'disabled';
  health_reason: string;
}

interface ScheduleStatus {
  summary: {
    healthy: number;
    running: number;
    stale: number;
    error: number;
    never_run: number;
    disabled: number;
    as_of: string;
  };
  schedules: ScheduleRow[];
  sam_budget: { used?: number; limit?: number; remaining?: number; resets_at?: string } | null;
}

export function SchedulePage() {
  const [data, setData] = React.useState<ScheduleStatus | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [reloadToken, setReloadToken] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setData(null);
    (async () => {
      try {
        const r = await api.get<ScheduleStatus>('/schedule/status');
        if (alive) setData(r);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [reloadToken]);

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Operate"
        title="Schedule"
        description="Health of replicated sources. Each row maps to a systemd timer on the Oracle Cloud sidecar."
        actions={
          <Button variant="secondary" onClick={() => setReloadToken((n) => n + 1)}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {data === null ? (
          <>
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
          </>
        ) : (
          <>
            <Stat label="Healthy"   value={fmtInt(data.summary.healthy)}   icon={CalendarRange} accent="sage" />
            <Stat label="Running"   value={fmtInt(data.summary.running)}   icon={CalendarRange} accent="warning" />
            <Stat label="Stale"     value={fmtInt(data.summary.stale)}     icon={CalendarRange} accent="vermilion" />
            <Stat label="Error"     value={fmtInt(data.summary.error)}     icon={CalendarRange} accent="vermilion" />
          </>
        )}
      </section>

      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3 }}
      >
        <Card>
          <div className="border-b border-border px-6 py-4">
            <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
              Sources
            </div>
            <h2 className="text-lg font-bold tracking-tight">Replication schedule</h2>
          </div>
          {data === null ? (
            <TableSkeleton rows={6} />
          ) : data.schedules.length === 0 ? (
            <EmptyState>No sources defined.</EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source</TableHead>
                  <TableHead>Cadence</TableHead>
                  <TableHead>Last run</TableHead>
                  <TableHead>Next run</TableHead>
                  <TableHead>Health</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {data.schedules.map((s) => (
                  <TableRow key={s.source_id}>
                    <TableCell>
                      <div className="font-medium text-foreground">{s.display_name}</div>
                      <div className="font-mono text-[11px] text-muted-soft">{s.source_id}</div>
                    </TableCell>
                    <TableCell className="text-muted">
                      <div>{s.interval_human}</div>
                      <div className="font-mono text-[11px] text-muted-soft">{s.cron}</div>
                    </TableCell>
                    <TableCell className="text-muted">
                      {s.last_run ? (
                        <>
                          <div className="text-foreground">{fmtDateTime(s.last_run.started_at)}</div>
                          <div className="text-[11px] text-muted-soft">
                            {fmtInt(s.last_run.rows_upserted)} upserted ·{' '}
                            <StatusBadge status={s.last_run.status} />
                          </div>
                        </>
                      ) : '—'}
                    </TableCell>
                    <TableCell className="text-muted">
                      {s.next_run_estimated ? (
                        <>
                          <div className="text-foreground">{fmtDateTime(s.next_run_estimated)}</div>
                          <div className="text-[11px] text-muted-soft">
                            {relativeTime(s.next_run_estimated)}
                          </div>
                        </>
                      ) : '—'}
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={s.health} />
                      <div className="mt-1 max-w-[260px] text-[11px] text-muted-soft">
                        {s.health_reason}
                      </div>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          )}
        </Card>
      </motion.div>

      {data?.sam_budget && (
        <Card>
          <div className="grid gap-4 p-6 sm:grid-cols-3">
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
                SAM API budget
              </div>
              <h3 className="mt-1 text-base font-bold">Daily limit</h3>
            </div>
            <Stat label="Used" value={fmtInt(data.sam_budget.used ?? 0)} accent="muted" />
            <Stat
              label="Remaining"
              value={fmtInt(data.sam_budget.remaining ?? 0)}
              sub={data.sam_budget.resets_at ? `Resets ${relativeTime(data.sam_budget.resets_at)}` : undefined}
              accent="sage"
            />
          </div>
        </Card>
      )}
    </div>
  );
}
