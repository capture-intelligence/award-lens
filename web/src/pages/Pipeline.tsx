import * as React from 'react';
import { Briefcase, Clock, Sparkles, AlertTriangle, ChevronDown, ChevronRight, ExternalLink } from 'lucide-react';
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
import { fmtDate } from '@/lib/utils';
import { PageHeader } from '@/components/ui/PageHeader';

interface Solicitation {
  solicitation_id: string;
  sol_number: string | null;
  notice_type: string;
  title: string;
  posted_date: string | null;
  response_deadline: string | null;
  agency: string | null;
  sub_agency: string | null;
  office: string | null;
  naics_codes: string | null;
  set_aside: string | null;
  link: string | null;
  attachment_count: number;
  extracted_count: number;
  summarized_count: number;
  days_to_deadline: number | null;
}

interface Stats {
  total_solicitations: number;
  open_now: number;
  due_in_14d: number;
  summarized_attachments: number;
  notice_types: Array<{ notice_type: string; n: number }>;
  set_asides:   Array<{ set_aside: string; n: number }>;
}

interface AttachmentDetail {
  attachment_id: string;
  file_name: string | null;
  file_url: string | null;
  file_type: string | null;
  extracted_chars: number | null;
  extract_error: string | null;
  sow_summary: string | null;
  summarized_at: number | null;
}

interface Detail {
  solicitation: Solicitation & { description: string | null; raw_json: string | null };
  attachments: AttachmentDetail[];
}

export function PipelinePage() {
  const [stats, setStats] = React.useState<Stats | null>(null);
  const [rows, setRows] = React.useState<Solicitation[] | null>(null);
  const [error, setError] = React.useState<string | null>(null);
  const [q, setQ] = React.useState('');
  const [noticeType, setNoticeType] = React.useState<string | null>(null);
  const [setAside,   setSetAside]   = React.useState<string | null>(null);
  const [openOnly,   setOpenOnly]   = React.useState(true);
  const [expanded,   setExpanded]   = React.useState<string | null>(null);
  const [details,    setDetails]    = React.useState<Record<string, Detail>>({});

  // Initial stats fetch
  React.useEffect(() => {
    let alive = true;
    api.get<Stats>('/pipeline/stats')
       .then((s) => { if (alive) setStats(s); })
       .catch((e) => { if (alive) setError(e instanceof ApiError ? `Stats API ${e.status}` : 'Stats failed'); });
    return () => { alive = false; };
  }, []);

  // Filtered list — refetch when filters change. Debounce search by 300ms.
  React.useEffect(() => {
    let alive = true;
    const t = setTimeout(async () => {
      try {
        const params = new URLSearchParams();
        if (q.trim())   params.set('q', q.trim());
        if (noticeType) params.set('notice_type', noticeType);
        if (setAside)   params.set('set_aside',   setAside);
        params.set('open_only', String(openOnly));
        const r = await api.get<{ results: Solicitation[] }>(`/pipeline/solicitations?${params}`);
        if (alive) setRows(r.results ?? []);
      } catch (e) {
        if (alive) setError(e instanceof ApiError ? `API ${e.status}` : 'Failed to load');
      }
    }, q ? 300 : 0);
    return () => { alive = false; clearTimeout(t); };
  }, [q, noticeType, setAside, openOnly]);

  async function toggleExpand(id: string) {
    if (expanded === id) { setExpanded(null); return; }
    setExpanded(id);
    if (!details[id]) {
      try {
        const d = await api.get<Detail>(`/pipeline/solicitations/${id}`);
        setDetails((prev) => ({ ...prev, [id]: d }));
      } catch (e) {
        // Silent fail — row stays open with a "couldn't load" note
        setDetails((prev) => ({ ...prev, [id]: { solicitation: null as unknown as Detail['solicitation'], attachments: [] } }));
      }
    }
  }

  return (
    <div className="space-y-8">
      <PageHeader
        eyebrow="Explore"
        title="Pipeline"
        description="Open CDC solicitations from SAM.gov, with AI-generated summaries of the attached SOW/RFP documents."
      />

      {error && (
        <div className="rounded-xl border border-brand-vermilion/40 bg-brand-vermilion/15 px-4 py-3 text-sm text-brand-vermilion-soft">
          {error}
        </div>
      )}

      {/* Stat cards */}
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {stats === null ? (
          <><StatSkeleton /><StatSkeleton /><StatSkeleton /><StatSkeleton /></>
        ) : (
          <>
            <Card><Stat label="Open now"           value={String(stats.open_now ?? 0)}              icon={<Briefcase className="h-4 w-4" />} /></Card>
            <Card><Stat label="Due in 14 days"     value={String(stats.due_in_14d ?? 0)}            icon={<Clock     className="h-4 w-4" />} /></Card>
            <Card><Stat label="With AI summary"    value={String(stats.summarized_attachments ?? 0)} icon={<Sparkles  className="h-4 w-4" />} /></Card>
            <Card><Stat label="Total solicitations" value={String(stats.total_solicitations ?? 0)} /></Card>
          </>
        )}
      </section>

      {/* Filter chips */}
      <section className="space-y-3">
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="search"
            placeholder="Search title or solicitation number…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            className="min-w-[260px] flex-1 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-2 text-sm text-foreground placeholder:text-muted-soft outline-none focus:border-brand-vermilion/60"
          />
          <label className="flex cursor-pointer items-center gap-2 px-3 py-2 text-sm text-muted-soft">
            <input
              type="checkbox"
              checked={openOnly}
              onChange={(e) => setOpenOnly(e.target.checked)}
              className="h-4 w-4 accent-brand-vermilion"
            />
            Open only
          </label>
        </div>

        {stats && stats.notice_types.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-soft">Notice type:</span>
            <FilterChip label="All" active={noticeType === null} onClick={() => setNoticeType(null)} />
            {stats.notice_types.map((t) => (
              <FilterChip
                key={t.notice_type}
                label={`${t.notice_type} (${t.n})`}
                active={noticeType === t.notice_type}
                onClick={() => setNoticeType(t.notice_type)}
              />
            ))}
          </div>
        )}

        {stats && stats.set_asides.length > 0 && (
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-xs uppercase tracking-wide text-muted-soft">Set-aside:</span>
            <FilterChip label="All" active={setAside === null} onClick={() => setSetAside(null)} />
            {stats.set_asides.map((s) => (
              <FilterChip
                key={s.set_aside}
                label={`${s.set_aside} (${s.n})`}
                active={setAside === s.set_aside}
                onClick={() => setSetAside(s.set_aside)}
              />
            ))}
          </div>
        )}
      </section>

      {/* Table */}
      <Card className="overflow-hidden p-0">
        {rows === null ? (
          <TableSkeleton rows={8} />
        ) : rows.length === 0 ? (
          <EmptyState
            icon={<AlertTriangle className="h-6 w-6" />}
            title="No solicitations match"
            description="Try clearing filters or expanding the date range."
          />
        ) : (
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead className="w-8" />
                <TableHead>Title</TableHead>
                <TableHead>Type</TableHead>
                <TableHead>Deadline</TableHead>
                <TableHead>Set-aside</TableHead>
                <TableHead>Docs</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {rows.map((s) => (
                <React.Fragment key={s.solicitation_id}>
                  <TableRow
                    className="cursor-pointer hover:bg-brand-teal-deep/40"
                    onClick={() => toggleExpand(s.solicitation_id)}
                  >
                    <TableCell>
                      {expanded === s.solicitation_id
                        ? <ChevronDown  className="h-4 w-4 text-muted-soft" />
                        : <ChevronRight className="h-4 w-4 text-muted-soft" />}
                    </TableCell>
                    <TableCell className="font-medium">
                      <div className="flex flex-col gap-0.5">
                        <span>{s.title}</span>
                        <span className="text-xs text-muted-soft">
                          {s.sol_number ?? '(no sol#)'} · {s.office ?? s.sub_agency ?? s.agency ?? '—'}
                        </span>
                      </div>
                    </TableCell>
                    <TableCell><span className="text-xs">{s.notice_type}</span></TableCell>
                    <TableCell>
                      {s.response_deadline
                        ? <DeadlineCell date={s.response_deadline} days={s.days_to_deadline} />
                        : <span className="text-muted-soft">—</span>}
                    </TableCell>
                    <TableCell><span className="text-xs">{s.set_aside ?? '—'}</span></TableCell>
                    <TableCell>
                      <div className="flex items-center gap-1.5">
                        <span className="text-xs">{s.attachment_count}</span>
                        {s.summarized_count > 0 && (
                          <Badge variant="success" className="text-[10px]">
                            <Sparkles className="mr-1 h-2.5 w-2.5" />
                            {s.summarized_count} AI
                          </Badge>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                  {expanded === s.solicitation_id && (
                    <TableRow className="bg-brand-teal-deep/30">
                      <TableCell colSpan={6} className="px-6 py-4">
                        <DetailPanel
                          detail={details[s.solicitation_id]}
                          fallbackLink={s.link}
                        />
                      </TableCell>
                    </TableRow>
                  )}
                </React.Fragment>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>
    </div>
  );
}

function FilterChip({ label, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        'rounded-full border px-3 py-1 text-xs transition ' +
        (active
          ? 'border-brand-vermilion/60 bg-brand-vermilion/20 text-brand-vermilion-soft'
          : 'border-border bg-transparent text-muted-soft hover:border-foreground/30')
      }
    >
      {label}
    </button>
  );
}

function DeadlineCell({ date, days }: { date: string; days: number | null }) {
  const tone =
    days === null   ? 'text-muted-soft' :
    days < 0        ? 'text-muted-soft line-through' :
    days <= 7       ? 'text-brand-vermilion' :
    days <= 14      ? 'text-brand-amber-soft' :
                      'text-foreground';
  return (
    <div className="flex flex-col">
      <span className={`text-sm ${tone}`}>{fmtDate(date)}</span>
      {days !== null && days >= 0 && (
        <span className={`text-[10px] ${tone}`}>
          {days === 0 ? 'today' : days === 1 ? '1 day' : `${days} days`}
        </span>
      )}
    </div>
  );
}

function DetailPanel({ detail, fallbackLink }: { detail: Detail | undefined; fallbackLink: string | null }) {
  if (!detail) return <div className="text-sm text-muted-soft">Loading…</div>;
  if (!detail.solicitation && detail.attachments.length === 0) {
    return <div className="text-sm text-muted-soft">Couldn't load detail.</div>;
  }
  const summarized = detail.attachments.filter((a) => a.sow_summary);
  const others     = detail.attachments.filter((a) => !a.sow_summary);

  return (
    <div className="space-y-4">
      {summarized.length === 0 && (
        <div className="rounded-md border border-border bg-brand-teal-deep/20 px-4 py-3 text-sm text-muted-soft">
          No AI summary yet for this solicitation. Attachments may still be in the extraction pipeline.
        </div>
      )}

      {summarized.map((a) => (
        <div key={a.attachment_id} className="rounded-md border border-border bg-brand-teal-deep/40 p-4">
          <div className="mb-2 flex items-baseline justify-between gap-3">
            <div className="text-sm font-medium">
              <Sparkles className="mr-1 inline h-3.5 w-3.5 text-brand-vermilion" />
              {a.file_name ?? a.attachment_id}
            </div>
            {a.file_url && (
              <a
                href={a.file_url}
                target="_blank"
                rel="noreferrer"
                className="flex items-center gap-1 text-xs text-muted-soft hover:text-foreground"
              >
                Source PDF <ExternalLink className="h-3 w-3" />
              </a>
            )}
          </div>
          <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
            {a.sow_summary}
          </div>
        </div>
      ))}

      {others.length > 0 && (
        <details className="text-sm text-muted-soft">
          <summary className="cursor-pointer">{others.length} other attachment{others.length === 1 ? '' : 's'} (no summary)</summary>
          <ul className="mt-2 space-y-1 pl-4">
            {others.map((a) => (
              <li key={a.attachment_id} className="text-xs">
                {a.file_name ?? a.attachment_id}
                {a.extract_error && <span className="ml-2 text-brand-vermilion-soft">({a.extract_error.slice(0, 60)})</span>}
              </li>
            ))}
          </ul>
        </details>
      )}

      {fallbackLink && (
        <a
          href={fallbackLink}
          target="_blank"
          rel="noreferrer"
          className="flex items-center gap-1 text-xs text-muted-soft hover:text-foreground"
        >
          View on SAM.gov <ExternalLink className="h-3 w-3" />
        </a>
      )}
    </div>
  );
}
