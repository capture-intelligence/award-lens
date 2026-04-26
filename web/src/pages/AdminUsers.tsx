import * as React from 'react';
import { motion } from 'framer-motion';
import { toast } from 'sonner';
import { CheckCircle2, XCircle, ShieldCheck, Hourglass, Users as UsersIcon } from 'lucide-react';
import { Card, Stat } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar';
import { RoleBadge } from '@/components/ui/Badge';
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
import { TableSkeleton, StatSkeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { fmtDateTime, fmtInt, initials, relativeTime } from '@/lib/utils';
import { useAuth, type Role, type AppUser } from '@/lib/auth-context';
import { PageHeader } from '@/components/ui/PageHeader';

interface UserStats {
  pending: number;
  user: number;
  admin: number;
  rejected: number;
}

const FILTERS: Array<{ value: Role | 'all'; label: string }> = [
  { value: 'all',      label: 'All' },
  { value: 'pending',  label: 'Pending' },
  { value: 'user',     label: 'Approved' },
  { value: 'admin',    label: 'Admins' },
  { value: 'rejected', label: 'Rejected' },
];

export function AdminUsersPage() {
  const { user: me } = useAuth();
  const [filter, setFilter] = React.useState<Role | 'all'>('pending');
  const [users, setUsers] = React.useState<AppUser[] | null>(null);
  const [stats, setStats] = React.useState<UserStats | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [busy, setBusy] = React.useState<string | null>(null);
  const [token, setToken] = React.useState(0);

  React.useEffect(() => {
    let alive = true;
    setUsers(null);
    setError(null);
    (async () => {
      try {
        const [u, s] = await Promise.all([
          api.get<{ results: AppUser[] }>('/admin/users', filter === 'all' ? {} : { role: filter }),
          api.get<UserStats>('/admin/stats/users'),
        ]);
        if (!alive) return;
        setUsers(u.results ?? []);
        setStats(s);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    })();
    return () => { alive = false; };
  }, [filter, token]);

  async function approve(u: AppUser) {
    setBusy(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/approve`);
      toast.success(`Approved ${u.email}`);
      setToken((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Approve failed');
    } finally {
      setBusy(null);
    }
  }

  async function reject(u: AppUser) {
    if (!confirm(`Reject ${u.email}?`)) return;
    setBusy(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/reject`);
      toast.success(`Rejected ${u.email}`);
      setToken((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Reject failed');
    } finally {
      setBusy(null);
    }
  }

  async function setRole(u: AppUser, role: Role) {
    if (u.role === role) return;
    if (u.user_id === me?.user_id && role !== 'admin') {
      toast.error("You can't demote yourself.");
      return;
    }
    setBusy(u.user_id);
    try {
      await api.post(`/admin/users/${u.user_id}/role`, { role });
      toast.success(`${u.email} → ${role}`);
      setToken((n) => n + 1);
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Role change failed');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Admin"
        title="Users"
        description="Manage who can access the dashboard. Approve pending requests, promote/demote, or revoke."
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats === null ? (
          <>
            <StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton />
          </>
        ) : (
          <>
            <Stat label="Pending"  value={fmtInt(stats.pending)}  icon={Hourglass}    accent="warning" />
            <Stat label="Approved" value={fmtInt(stats.user)}     icon={CheckCircle2} accent="sage" />
            <Stat label="Admins"   value={fmtInt(stats.admin)}    icon={ShieldCheck}  accent="vermilion" />
            <Stat label="Rejected" value={fmtInt(stats.rejected)} icon={XCircle}      accent="muted" />
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
                Directory
              </div>
              <h2 className="text-lg font-bold tracking-tight">Users</h2>
            </div>
            <div className="flex items-end gap-2">
              <div>
                <Label>Filter</Label>
                <Select
                  value={filter}
                  onChange={(e) => setFilter(e.target.value as Role | 'all')}
                >
                  {FILTERS.map((f) => (
                    <option key={f.value} value={f.value}>{f.label}</option>
                  ))}
                </Select>
              </div>
            </div>
          </div>

          {users === null ? (
            <TableSkeleton rows={8} />
          ) : users.length === 0 ? (
            <EmptyState>
              <UsersIcon className="mx-auto mb-2 h-6 w-6 text-brand-sage" />
              No users in this view.
            </EmptyState>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>User</TableHead>
                  <TableHead>Role</TableHead>
                  <TableHead>Provider</TableHead>
                  <TableHead>Created / last login</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {users.map((u) => {
                  const isBusy = busy === u.user_id;
                  const isMe = u.user_id === me?.user_id;
                  return (
                    <TableRow key={u.user_id}>
                      <TableCell>
                        <div className="flex items-center gap-3">
                          <Avatar className="h-9 w-9">
                            {u.avatar_url ? <AvatarImage src={u.avatar_url} alt="" /> : null}
                            <AvatarFallback>{initials(u.display_name ?? u.email)}</AvatarFallback>
                          </Avatar>
                          <div className="min-w-0">
                            <div className="truncate font-medium text-foreground">
                              {u.display_name ?? '—'}
                              {isMe && <span className="ml-2 text-[10px] uppercase tracking-[0.12em] text-brand-sage">you</span>}
                            </div>
                            <div className="truncate text-xs text-muted">{u.email}</div>
                          </div>
                        </div>
                      </TableCell>
                      <TableCell><RoleBadge role={u.role} /></TableCell>
                      <TableCell className="text-xs text-muted">{u.provider}</TableCell>
                      <TableCell className="text-xs text-muted">
                        <div>{fmtDateTime(u.created_at)}</div>
                        <div className="text-[11px] text-muted-soft">
                          last: {u.last_login_at ? relativeTime(u.last_login_at) : '—'}
                        </div>
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex items-center justify-end gap-2">
                          {u.role === 'pending' && (
                            <>
                              <Button
                                variant="success"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => approve(u)}
                              >
                                Approve
                              </Button>
                              <Button
                                variant="danger"
                                size="sm"
                                disabled={isBusy}
                                onClick={() => reject(u)}
                              >
                                Reject
                              </Button>
                            </>
                          )}
                          {(u.role === 'user' || u.role === 'admin') && !isMe && (
                            <Button
                              variant="outline"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => setRole(u, u.role === 'admin' ? 'user' : 'admin')}
                            >
                              {u.role === 'admin' ? 'Demote' : 'Promote'}
                            </Button>
                          )}
                          {(u.role === 'rejected' || u.role === 'user' || u.role === 'admin') && !isMe && (
                            <Button
                              variant="ghost"
                              size="sm"
                              disabled={isBusy}
                              onClick={() => setRole(u, 'rejected')}
                            >
                              Revoke
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
