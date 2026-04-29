import { motion } from 'framer-motion';
import { toast } from 'sonner';
import {
  Database, Hourglass, Lock, ShieldCheck,
  ArrowRight, RefreshCw, ShieldX,
  Edit3, Play, CheckCircle2, XCircle, Clock,
} from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { Button } from '@/components/ui/Button';
import { Skeleton } from '@/components/ui/Skeleton';
import { api, ApiError } from '@/lib/api';
import { useViews } from '@/lib/view-context';
import { useAuth } from '@/lib/auth-context';
import { fmtInt, relativeTime } from '@/lib/utils';
import type { BrowseViewRow, ViewFilters, ViewLatestRequest } from '@/lib/views';
import { TOPTIERS, subtiersFor } from '@/lib/agencies';
import { navigate } from '@/lib/router';
import { PageHeader } from '@/components/ui/PageHeader';

export function BrowseViewsPage() {
  const { browse, loading, error, refresh, setActive } = useViews();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  async function request(viewId: string) {
    try {
      // /filters is the new path; viewId == filterId post-PR1 façade.
      await api.post(`/filters/${viewId}/request`);
      toast.success('Access requested. An admin will review.');
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Request failed');
    }
  }

  async function runNow(viewId: string, viewName: string) {
    try {
      const r = await api.post<{ request_id: string; status: string; deduped?: boolean }>(
        `/admin/views/${viewId}/run`,
      );
      toast.success(
        r.deduped
          ? `${viewName}: a run is already queued`
          : `${viewName}: queued — sidecar picks it up within ~60s`,
      );
      void refresh();
    } catch (e) {
      toast.error(e instanceof ApiError ? `API ${e.status}` : 'Trigger failed');
    }
  }

  return (
    <div className="space-y-6">
      <PageHeader
        eyebrow="Views"
        title={isAdmin ? 'All views' : 'Browse views'}
        description={
          isAdmin
            ? 'All curated data slices. As admin you have implicit access to every enabled view — pick one to scope the dashboard.'
            : 'Curated slices of federal awards data. Request access to a view; once an admin grants it, you can scope the dashboard to that data set.'
        }
        actions={
          <Button variant="secondary" onClick={() => void refresh()}>
            <RefreshCw className="mr-2 h-4 w-4" /> Refresh
          </Button>
        }
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      {loading ? (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {Array.from({ length: 4 }).map((_, i) => (
            <Card key={i} className="p-6"><Skeleton className="h-32 w-full" /></Card>
          ))}
        </div>
      ) : browse.length === 0 ? (
        <Card>
          <div className="px-6 py-12 text-center">
            <Database className="mx-auto h-7 w-7 text-brand-sage" />
            <p className="mt-3 text-sm text-muted">
              No views are configured yet.
              {isAdmin
                ? ' Create one from the Views admin page to get started.'
                : ' Once an admin defines views, you can request access.'}
            </p>
            {isAdmin && (
              <Button variant="primary" className="mt-4" onClick={() => navigate('/admin/views')}>
                Create a view
              </Button>
            )}
          </div>
        </Card>
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {browse.map((v) => (
            <ViewCard
              key={v.view_id}
              view={v}
              isAdmin={isAdmin}
              onRequest={() => request(v.view_id)}
              onOpen={() => { setActive(v.view_id); navigate('/awards'); }}
              onEdit={() => navigate('/admin/views')}
              onRunNow={() => runNow(v.view_id, v.name)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function ViewCard({
  view, isAdmin, onRequest, onOpen, onEdit, onRunNow,
}: {
  view: BrowseViewRow;
  isAdmin: boolean;
  onRequest: () => void;
  onOpen: () => void;
  onEdit: () => void;
  onRunNow: () => void;
}) {
  const status = view.access?.status;
  const granted = isAdmin || status === 'granted';
  const count = view.award_count ?? 0;
  const empty = count === 0;

  return (
    <motion.div
      initial={{ opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
    >
      <Card className="h-full">
        <div className="flex h-full flex-col p-6">
          <div className="flex items-start justify-between gap-3">
            <h3 className="text-lg font-bold tracking-tight">{view.name}</h3>
            <StatusBadge status={view.access?.status} isAdmin={isAdmin} />
          </div>
          {view.description && (
            <p className="mt-2 text-xs text-muted">{view.description}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-1.5">
            <FilterChips filters={view.filters} />
          </div>

          {/* Data + ingestion strip */}
          <div className="mt-5 flex flex-wrap items-center gap-2 border-t border-border pt-4 text-[11px]">
            <span
              className={
                empty
                  ? 'inline-flex items-center gap-1 rounded-md border border-warning/30 bg-warning/10 px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-warning'
                  : 'inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/10 px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-success'
              }
            >
              <Database className="h-3 w-3" />
              {empty ? 'No data yet' : `${fmtInt(count)} awards`}
            </span>
            {isAdmin && view.latest_request && (
              <IngestStatusChip req={view.latest_request} />
            )}
          </div>

          <div className="mt-5 flex flex-wrap items-center justify-end gap-2">
            {isAdmin && (
              <>
                <Button variant="ghost" size="sm" onClick={onEdit} title="Edit view definition">
                  <Edit3 className="mr-1 h-4 w-4" /> Edit
                </Button>
                <Button variant="success" size="sm" onClick={onRunNow} title="Trigger an immediate ingestion for this view">
                  <Play className="mr-1 h-4 w-4" /> Run now
                </Button>
              </>
            )}
            {granted ? (
              <Button variant="primary" size="sm" onClick={onOpen}>
                Open <ArrowRight className="ml-1 h-4 w-4" />
              </Button>
            ) : status === 'requested' ? (
              <Button variant="ghost" size="sm" disabled>
                <Hourglass className="mr-1 h-4 w-4" /> Pending
              </Button>
            ) : status === 'denied' || status === 'revoked' ? (
              <Button variant="outline" size="sm" onClick={onRequest}>
                Request again
              </Button>
            ) : (
              <Button variant="primary" size="sm" onClick={onRequest}>
                Request access
              </Button>
            )}
          </div>
        </div>
      </Card>
    </motion.div>
  );
}

function IngestStatusChip({ req }: { req: ViewLatestRequest }) {
  if (req.status === 'running') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-warning/40 bg-warning/15 px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-warning">
        <Clock className="h-3 w-3 animate-pulse" />
        Running · #{req.attempt}
      </span>
    );
  }
  if (req.status === 'pending') {
    const queued = new Date(req.next_attempt_at).getTime() <= Date.now();
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-brand-sage/30 bg-brand-sage/15 px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-brand-sage">
        <Clock className="h-3 w-3" />
        {queued ? 'Queued' : `Retry in ${relativeTime(req.next_attempt_at).replace('in ', '')}`}
      </span>
    );
  }
  if (req.status === 'success') {
    return (
      <span className="inline-flex items-center gap-1 rounded-md border border-success/30 bg-success/15 px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-success">
        <CheckCircle2 className="h-3 w-3" />
        Synced {req.finished_at ? relativeTime(req.finished_at) : ''}
      </span>
    );
  }
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md border border-brand-vermilion/30 bg-brand-vermilion/15 px-2 py-0.5 font-bold uppercase tracking-[0.06em] text-brand-vermilion-soft"
      title={req.error_message ?? ''}
    >
      <XCircle className="h-3 w-3" />
      Failed · {req.attempt}/{req.max_attempts}
    </span>
  );
}

function StatusBadge({
  status, isAdmin,
}: {
  status: 'requested' | 'granted' | 'denied' | 'revoked' | undefined;
  isAdmin: boolean;
}) {
  if (isAdmin) {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-brand-vermilion/30 bg-brand-vermilion/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-vermilion-soft">
        <ShieldCheck className="h-3 w-3" /> Admin
      </span>
    );
  }
  if (status === 'granted') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-success/30 bg-success/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-success">
        <ShieldCheck className="h-3 w-3" /> Granted
      </span>
    );
  }
  if (status === 'requested') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-warning/30 bg-warning/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-warning">
        <Hourglass className="h-3 w-3" /> Pending
      </span>
    );
  }
  if (status === 'denied' || status === 'revoked') {
    return (
      <span className="inline-flex items-center gap-1 rounded-full border border-brand-vermilion/30 bg-brand-vermilion/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-brand-vermilion-soft">
        <ShieldX className="h-3 w-3" /> {status === 'denied' ? 'Denied' : 'Revoked'}
      </span>
    );
  }
  return (
    <span className="inline-flex items-center gap-1 rounded-full border border-border bg-brand-teal-deep/40 px-2 py-0.5 text-[10px] font-bold uppercase tracking-[0.06em] text-muted">
      <Lock className="h-3 w-3" /> Locked
    </span>
  );
}

function FilterChips({ filters }: { filters: ViewFilters }) {
  const chips: string[] = [];
  // Show agency abbreviations when we know them, else the bare name.
  if (filters.toptier_agency_name) {
    const top = TOPTIERS.find((t) => t.name === filters.toptier_agency_name);
    chips.push(top?.abbrev ?? filters.toptier_agency_name);
  }
  if (filters.subtier_agency_name) {
    const sub = subtiersFor(filters.toptier_agency_name).find(
      (s) => s.name === filters.subtier_agency_name,
    );
    chips.push(sub?.abbrev ?? filters.subtier_agency_name);
  }
  if (filters.keywords?.length)    chips.push(...filters.keywords);
  if (filters.naics_codes?.length) chips.push(`${filters.naics_codes.length} NAICS`);
  if (filters.psc_codes?.length)   chips.push(`${filters.psc_codes.length} PSC`);
  if (filters.pop_states?.length)  chips.push(filters.pop_states.length <= 3
    ? filters.pop_states.join('/')
    : `${filters.pop_states.length} states`);
  if (filters.lookback_months && filters.forward_months) {
    chips.push(`−${filters.lookback_months}/+${filters.forward_months}mo`);
  } else if (filters.lookback_months) {
    chips.push(`−${filters.lookback_months}mo`);
  } else if (filters.forward_months) {
    chips.push(`+${filters.forward_months}mo`);
  }
  if (filters.min_value != null && filters.max_value != null) {
    chips.push(`$${fmtInt(filters.min_value)}–$${fmtInt(filters.max_value)}`);
  } else if (filters.min_value != null) {
    chips.push(`≥$${fmtInt(filters.min_value)}`);
  } else if (filters.max_value != null) {
    chips.push(`≤$${fmtInt(filters.max_value)}`);
  }
  if (chips.length === 0) return <span className="text-[11px] text-muted-soft">Unfiltered</span>;
  return (
    <>
      {chips.slice(0, 6).map((c, i) => (
        <span key={i} className="rounded-md border border-border bg-brand-teal-deep/40 px-2 py-0.5 text-[10px] uppercase tracking-[0.06em] text-muted">
          {c}
        </span>
      ))}
    </>
  );
}
