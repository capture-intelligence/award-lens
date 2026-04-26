import * as React from 'react';
import { motion } from 'framer-motion';
import { History, Ban } from 'lucide-react';
import { toast } from 'sonner';
import { Card } from '@/components/ui/Card';
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
import { TableSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtInt } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface RunRow {
  run_id: number;
  source_id: string;
  started_at: string;
  finished_at: string | null;
  status: string;
  rows_fetched: number;
  rows_upserted: number;
  rows_failed: number;
  watermark_before: string | null;
  watermark_after: string | null;
}

export function RunsPage() {
  const [rows, setRows] = React.useState<RunRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [token, setToken] = React.useState(0);
  const [cancelling, setCancelling] = React.useState<number | null>(null);

  React.useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: RunRow[] }>('/runs');
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [token]);

  async function cancel(runId: number) {
    if (!confirm(`Cancel run #${runId}?`)) return;
    setCancelling(runId);
    try {
      await api.post(`/runs/${runId}/cancel`);
      toast.success(`Run #${runId} marked cancelled`);
      setToken((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Cancel failed');
    } finally {
      setCancelling(null);
    }
  }

  async function cancelAll() {
    if (!confirm('Cancel ALL running ingestion runs?')) return;
    try {
      await api.post('/runs/cancel-all');
      toast.success('All running ingestions cancelled');
      setToken((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Cancel failed');
    }
  }

  const hasRunning = (rows ?? []).some((r) => r.status === 'running');

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Operate"
        title="Runs"
        description="Most recent 50 ingestion runs across all sources."
        actions={
          <>
            <Button variant="secondary" onClick={() => setToken((n) => n + 1)}>
              Refresh
            </Button>
            <Button
              variant="danger"
              onClick={cancelAll}
              disabled={!hasRunning}
            >
              <Ban className="mr-2 h-4 w-4" />
              Cancel all running
            </Button>
          </>
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
            <EmptyState>
              <History className="mx-auto mb-2 h-6 w-6 text-brand-sage" />
              No runs yet.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Run</TableHead>
                  <TableHead>Source</TableHead>
                  <TableHead>Started</TableHead>
                  <TableHead>Finished</TableHead>
                  <TableHead className="text-right">Fetched / upserted / failed</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead></TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => (
                  <TableRow key={r.run_id}>
                    <TableCell className="font-mono text-xs text-muted">#{r.run_id}</TableCell>
                    <TableCell>
                      <div className="font-medium text-foreground">{r.source_id}</div>
                      {r.watermark_after && (
                        <div className="font-mono text-[11px] text-muted-soft">
                          → {r.watermark_after}
                        </div>
                      )}
                    </TableCell>
                    <TableCell className="text-muted">{fmtDateTime(r.started_at)}</TableCell>
                    <TableCell className="text-muted">
                      {r.finished_at ? fmtDateTime(r.finished_at) : '—'}
                    </TableCell>
                    <TableCell className="text-right font-mono text-xs">
                      {fmtInt(r.rows_fetched)} / {fmtInt(r.rows_upserted)} /{' '}
                      <span className={r.rows_failed > 0 ? 'text-brand-vermilion-soft' : 'text-muted-soft'}>
                        {fmtInt(r.rows_failed)}
                      </span>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={r.status} />
                    </TableCell>
                    <TableCell className="text-right">
                      {r.status === 'running' && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => cancel(r.run_id)}
                          disabled={cancelling === r.run_id}
                        >
                          {cancelling === r.run_id ? 'Cancelling…' : 'Cancel'}
                        </Button>
                      )}
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
