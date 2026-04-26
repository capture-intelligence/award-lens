import * as React from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, ShieldX, Inbox } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Badge } from '@/components/ui/Badge';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar';
import { Label, Select } from '@/components/ui/Input';
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
import { fmtDateTime, initials, relativeTime } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface AccessRequestRow {
  access_id: string;
  view_id: string;
  view_name: string;
  user_id: string;
  user_email: string;
  user_display_name: string | null;
  user_avatar_url: string | null;
  status: 'requested' | 'granted' | 'denied' | 'revoked';
  requested_at: string;
  requested_note: string | null;
  decided_at: string | null;
  decision_note: string | null;
}

const FILTERS: Array<{ value: string; label: string }> = [
  { value: 'requested', label: 'Pending' },
  { value: 'granted',   label: 'Granted' },
  { value: 'denied',    label: 'Denied' },
  { value: 'revoked',   label: 'Revoked' },
  { value: 'all',       label: 'All' },
];

export function AdminAccessRequestsPage() {
  const [filter, setFilter] = React.useState('requested');
  const [rows, setRows] = React.useState<AccessRequestRow[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [token, setToken] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setRows(null);
    setError(null);
    (async () => {
      try {
        const r = await api.get<{ results: AccessRequestRow[] }>(
          '/admin/access-requests',
          { status: filter },
        );
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [filter, token]);

  async function decide(row: AccessRequestRow, action: 'grant' | 'deny' | 'revoke') {
    if (action !== 'grant' && !confirm(`${action[0]!.toUpperCase() + action.slice(1)} ${row.user_email} access to "${row.view_name}"?`)) return;
    setBusy(row.access_id);
    try {
      await api.post(`/admin/access-requests/${row.access_id}/${action}`);
      toast.success(`${row.user_email} → ${action}ed`);
      setToken((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Action failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Admin"
        title="Access requests"
        description="Approve, deny, or revoke per-view access for users."
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
          <div className="flex items-center justify-between border-b border-border px-6 py-4">
            <h2 className="text-lg font-bold tracking-tight">Requests</h2>
            <div>
              <Label>Filter</Label>
              <Select value={filter} onChange={(e) => setFilter(e.target.value)}>
                {FILTERS.map((f) => <option key={f.value} value={f.value}>{f.label}</option>)}
              </Select>
            </div>
          </div>

          {rows === null ? (
            <TableSkeleton rows={6} />
          ) : rows.length === 0 ? (
            <EmptyState>
              <Inbox className="mx-auto mb-2 h-6 w-6 text-brand-sage" />
              No requests in this filter.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>View</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Requested</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {rows.map((r) => {
                  const isBusy = busy === r.access_id;
                  return (
                    <TableRow key={r.access_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            {r.user_avatar_url ? <AvatarImage src={r.user_avatar_url} alt="" /> : null}
                            <AvatarFallback>{initials(r.user_display_name ?? r.user_email)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {r.user_display_name ?? '—'}
                            </div>
                            <div className="truncate text-xs text-muted">{r.user_email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell className="font-medium">{r.view_name}</TableCell>
                      <TableCell>
                        <Badge
                          variant={
                            r.status === 'granted' ? 'success' :
                            r.status === 'requested' ? 'warning' :
                            'danger'
                          }
                        >
                          {r.status}
                        </Badge>
                        {r.decided_at && (
                          <div className="mt-1 text-[11px] text-muted-soft">
                            {r.status} {relativeTime(r.decided_at)}
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-xs text-muted">
                        {fmtDateTime(r.requested_at)}
                        {r.requested_note && (
                          <div className="mt-1 max-w-[280px] truncate text-[11px] text-muted-soft">
                            "{r.requested_note}"
                          </div>
                        )}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {r.status === 'requested' && (
                            <>
                              <Button variant="success" size="sm" disabled={isBusy} onClick={() => decide(r, 'grant')}>
                                <CheckCircle2 className="mr-1 h-4 w-4" /> Grant
                              </Button>
                              <Button variant="danger" size="sm" disabled={isBusy} onClick={() => decide(r, 'deny')}>
                                <XCircle className="mr-1 h-4 w-4" /> Deny
                              </Button>
                            </>
                          )}
                          {r.status === 'granted' && (
                            <Button variant="ghost" size="sm" disabled={isBusy} onClick={() => decide(r, 'revoke')}>
                              <ShieldX className="mr-1 h-4 w-4" /> Revoke
                            </Button>
                          )}
                          {(r.status === 'denied' || r.status === 'revoked') && (
                            <Button variant="outline" size="sm" disabled={isBusy} onClick={() => decide(r, 'grant')}>
                              <CheckCircle2 className="mr-1 h-4 w-4" /> Re-grant
                            </Button>
                          )}
                        </div>
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          )}
        </Card>
      </motion.div>
    </div>
  );
}
