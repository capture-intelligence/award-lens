import * as React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Calendar, FileText, Award, Users,
  Bell, BarChart3, Plus,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { AIBadge } from '@/components/ui/AISummaryToggle';
import { useAuth } from '@/lib/auth-context';
import { routes } from '@/lib/routes';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { api } from '@/lib/api';
import { ErrorBoundary } from '@/components/ErrorBoundary';

/**
 * DashboardHome — authenticated landing page (spec §3.1 Dashboard).
 * Layout per spec:
 *   - Welcome strip with profile-link CTA
 *   - 6-card onboarding grid (visible during trial)
 *   - Recommended Opportunities widget (AI-curated)
 *   - Business Development Calendar (6-month view)
 *   - Open Activities widget
 *   - News & Insights feed
 *
 * The KPI strip and the "Latest opportunities" widget are wired to live
 * endpoints (/stats/overview, /pipeline/solicitations). The calendar, open-
 * activities, and news sections are still placeholders until those domains
 * are ingested. Each section links through to its full list view.
 */

export function DashboardHomePage() {
  const { user } = useAuth();
  const today = new Date();

  return (
    <div className="flex flex-col gap-8 pb-12">
      {/* Welcome strip */}
      <PageHeader
        eyebrow="Today"
        title={`Good ${greeting(today.getHours())}, ${user?.display_name?.split(' ')[0] ?? 'analyst'}.`}
        description="Here's what's moving on your federal capture board today — fresh opportunities, pipeline activity, and intelligence relevant to your saved searches."
        actions={
          <Link
            to={routes.savedSearches}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30"
          >
            <Bell className="h-3.5 w-3.5" />
            Manage alerts
          </Link>
        }
      />

      {/* KPI strip. Each widget gets its own boundary so one failing section
          degrades in place instead of blanking the whole dashboard. */}
      <ErrorBoundary compact label="KPIs unavailable"><KPIStrip /></ErrorBoundary>

      {/* Two-column main */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <ErrorBoundary compact label="Latest opportunities unavailable"><RecommendedOpportunities /></ErrorBoundary>
          <ErrorBoundary compact label="Calendar unavailable"><CalendarWidget /></ErrorBoundary>
        </div>
        <div className="flex flex-col gap-6">
          <ErrorBoundary compact label="Activities unavailable"><OpenActivities /></ErrorBoundary>
          <ErrorBoundary compact label="News unavailable"><NewsWidget /></ErrorBoundary>
        </div>
      </div>
    </div>
  );
}

// ─── KPI strip ─────────────────────────────────────────────────────────────
// Two live endpoints back this strip: /stats/overview (warehouse award/vendor
// rollup) and /pipeline/stats (CDC solicitation pipeline). Every field is
// read defensively — a missing or null field renders "—", never a crash. The
// whole dashboard white-screened once because a direct `.toLocaleString()` on
// an absent field threw inside render; `num()` is the guard against that.
interface Overview {
  awards: number;
  vendors: number;
  organizations: number;
  total_obligated_usd: number;
}
interface PipelineStats {
  open_now: number;
  total_solicitations: number;
  summarized_attachments: number;
}

function KPIStrip() {
  const [o, setO] = React.useState<Partial<Overview> | null>(null);
  const [p, setP] = React.useState<Partial<PipelineStats> | null>(null);
  React.useEffect(() => {
    let alive = true;
    api.get<Overview>('/stats/overview').then((d) => { if (alive) setO(d); }).catch(() => { if (alive) setO(null); });
    api.get<PipelineStats>('/pipeline/stats').then((d) => { if (alive) setP(d); }).catch(() => { if (alive) setP(null); });
    return () => { alive = false; };
  }, []);

  const num = (v: number | null | undefined) => (v != null ? v.toLocaleString() : '—');
  const kpis = [
    { label: 'Open opportunities', value: num(p?.open_now),               delta: p?.total_solicitations != null ? `${p.total_solicitations.toLocaleString()} in pipeline` : 'loading…', icon: FileText, color: 'text-brand-vermilion-soft' },
    { label: 'Awards tracked',     value: num(o?.awards),                 delta: o?.total_obligated_usd != null ? `${fmtMoney(o.total_obligated_usd)} total` : 'loading…',               icon: Award,    color: 'text-brand-sage' },
    { label: 'Awardees indexed',   value: num(o?.vendors),                delta: 'vendors with awards',                                                                                 icon: Users,    color: 'text-foreground' },
    { label: 'Docs summarized',    value: num(p?.summarized_attachments), delta: 'AI SOW summaries',                                                                                    icon: Bell,     color: 'text-muted' },
  ];
  return (
    <ul className="grid grid-cols-2 gap-3 sm:grid-cols-4">
      {kpis.map((k) => (
        <motion.li
          key={k.label}
          initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }}
          className="rounded-xl border border-border bg-brand-teal-deep/30 p-4"
        >
          <div className="mb-2 flex items-center justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-soft">{k.label}</span>
            <k.icon className={`h-4 w-4 ${k.color}`} />
          </div>
          <div className="text-2xl font-black tracking-tight tabular-nums text-foreground">{k.value}</div>
          <div className="mt-0.5 text-[11px] text-muted-soft">{k.delta}</div>
        </motion.li>
      ))}
    </ul>
  );
}

// ─── Latest opportunities (live) ───────────────────────────────────────────
interface RecRow {
  solicitation_id: string;
  title: string;
  notice_type: string;
  response_deadline: string | null;
  agency: string | null;
  sub_agency: string | null;
  office: string | null;
  naics_codes: string | null;
  set_aside: string | null;
  summarized_count: number;
}

function RecommendedOpportunities() {
  const [recs, setRecs] = React.useState<RecRow[]>([]);
  const [loading, setLoading] = React.useState(true);
  React.useEffect(() => {
    let alive = true;
    api
      .get<{ results: RecRow[] }>('/pipeline/solicitations', { open_only: 'false', limit: 6 })
      .then((d) => { if (alive) setRecs(d.results ?? []); })
      .catch(() => { if (alive) setRecs([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, []);

  return (
    <Card>
      <CardHeader
        title="Latest opportunities"
        eyebrow="CDC Pipeline"
        description="The most recent CDC solicitations from SAM.gov. Similarity-ranked recommendations arrive once the embeddings job runs."
        cta={<Link to={routes.contractOpps} className="inline-flex items-center gap-1 text-[12px] text-muted-soft hover:text-foreground">
          See all <ArrowRight className="h-3 w-3" />
        </Link>}
      />
      {loading ? (
        <div className="px-4 py-6 text-sm text-muted">Loading…</div>
      ) : recs.length === 0 ? (
        <div className="px-4 py-6">
          <EmptyState icon={FileText} title="No opportunities yet." message="New CDC solicitations appear after the daily SAM.gov sync." />
        </div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/50">
          {recs.map((o) => {
            const agency = o.office ?? o.sub_agency ?? o.agency ?? '—';
            const naics = (o.naics_codes ?? '').split('|')[0] || null;
            return (
              <li key={o.solicitation_id} className="group">
                <Link
                  to={`/opportunity/contract/${o.solicitation_id}`}
                  className="block px-4 py-3 transition-colors hover:bg-brand-teal-soft/15"
                >
                  <div className="flex items-start gap-4">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-lg bg-brand-vermilion/15 text-brand-vermilion-soft ring-1 ring-brand-vermilion/30">
                      <FileText className="h-4 w-4" />
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="flex items-start justify-between gap-3">
                        <h3 className="truncate text-sm font-semibold text-foreground group-hover:text-brand-vermilion-soft">
                          {o.title}
                        </h3>
                        {o.summarized_count > 0 && <span className="shrink-0"><AIBadge label="AI summary" /></span>}
                      </div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-soft">
                        <span>{o.notice_type}</span>
                        <span>·</span>
                        <span className="truncate">{agency}</span>
                        {naics && (<><span>·</span><span>NAICS {naics}</span></>)}
                        <span>·</span>
                        <span>{o.set_aside ?? 'None'}</span>
                        {o.response_deadline && (<><span>·</span><span>Due {fmtDate(o.response_deadline)}</span></>)}
                      </div>
                    </div>
                  </div>
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ─── Calendar widget ──────────────────────────────────────────────────────
interface Deadline { kind: 'Grant' | 'Contract'; date: string; days: number | null; title: string; href: string; }

function CalendarWidget() {
  const [items, setItems] = React.useState<Deadline[] | null>(null);
  React.useEffect(() => {
    let alive = true;
    Promise.allSettled([
      api.get<{ results: Array<{ opportunity_id: string; title: string; close_date: string | null; days_to_close: number | null }> }>('/opportunities', { active: 'true', limit: '50' }),
      api.get<{ results: Array<{ solicitation_id: string; title: string; response_deadline: string | null; days_to_deadline: number | null }> }>('/pipeline/solicitations', { open_only: 'true', limit: '50' }),
    ]).then(([g, c]) => {
      if (!alive) return;
      const out: Deadline[] = [];
      if (g.status === 'fulfilled') for (const o of g.value.results ?? []) if (o.close_date) out.push({ kind: 'Grant', date: o.close_date, days: o.days_to_close, title: o.title, href: `/opportunity/grant/${o.opportunity_id}` });
      if (c.status === 'fulfilled') for (const s of c.value.results ?? []) if (s.response_deadline) out.push({ kind: 'Contract', date: s.response_deadline, days: s.days_to_deadline, title: s.title, href: `/opportunity/contract/${s.solicitation_id}` });
      out.sort((a, b) => a.date.localeCompare(b.date));
      setItems(out.slice(0, 10));
    }).catch(() => { if (alive) setItems([]); });
    return () => { alive = false; };
  }, []);

  return (
    <Card>
      <CardHeader
        title="Upcoming deadlines"
        eyebrow="Calendar"
        description="The soonest grant close dates and contract response deadlines across the warehouse."
        cta={<Link to={routes.grantOpps} className="inline-flex items-center gap-1 text-[12px] text-muted-soft hover:text-foreground">
          See all <ArrowRight className="h-3 w-3" />
        </Link>}
      />
      {items == null ? (
        <div className="px-4 py-6 text-sm text-muted">Loading…</div>
      ) : items.length === 0 ? (
        <div className="px-4 pb-4"><EmptyState compact icon={Calendar} title="No upcoming deadlines." message="New grant and contract deadlines appear here as opportunities post." /></div>
      ) : (
        <ul className="flex flex-col divide-y divide-border/50">
          {items.map((d, i) => (
            <li key={i} className="group">
              <Link to={d.href} className="block px-4 py-2.5 transition-colors hover:bg-brand-teal-soft/15">
                <div className="flex items-center justify-between gap-3">
                  <span className="truncate text-[13px] font-medium text-foreground group-hover:text-brand-vermilion-soft">{d.title}</span>
                  {d.days != null && d.days >= 0 && (
                    <span className={`shrink-0 rounded-full px-1.5 py-px text-[10px] font-bold ${d.days <= 14 ? 'bg-brand-vermilion/15 text-brand-vermilion-soft' : 'bg-brand-teal-soft/20 text-muted'}`}>{d.days}d</span>
                  )}
                </div>
                <div className="mt-0.5 text-[11px] text-muted-soft">{d.kind} · due {fmtDate(d.date)}</div>
              </Link>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ─── Open activities ──────────────────────────────────────────────────────
function OpenActivities() {
  return (
    <Card>
      <CardHeader
        title="Open activities"
        eyebrow="Today"
        cta={<Link to={routes.activities} className="inline-flex items-center gap-1 text-[12px] text-muted-soft hover:text-foreground">
          View all <ArrowRight className="h-3 w-3" />
        </Link>}
      />
      <div className="px-4 pb-4">
        <EmptyState
          compact
          icon={Calendar}
          title="Nothing yet."
          message="Once you create activities under a pursuit, they'll appear here."
          action={
            <Link
              to={routes.activities}
              className="inline-flex items-center gap-1 rounded-md border border-border bg-brand-teal-deep/40 px-2.5 py-1.5 text-[11px] text-foreground transition-colors hover:bg-brand-teal-soft/30"
            >
              <Plus className="h-3 w-3" /> New activity
            </Link>
          }
        />
      </div>
    </Card>
  );
}

// ─── News widget ──────────────────────────────────────────────────────────
function NewsWidget() {
  const articles = MOCK_NEWS;
  return (
    <Card>
      <CardHeader
        title="Industry news"
        eyebrow="Sample data"
        description="Placeholder headlines — a live news feed isn't wired yet."
        cta={<Link to={routes.news} className="inline-flex items-center gap-1 text-[12px] text-muted-soft hover:text-foreground">
          More <ArrowRight className="h-3 w-3" />
        </Link>}
      />
      <ul className="flex flex-col divide-y divide-border/50">
        {articles.map((a) => (
          <li key={a.id}>
            <a
              href={a.url}
              target="_blank"
              rel="noreferrer"
              className="block px-4 py-3 transition-colors hover:bg-brand-teal-soft/15"
            >
              <div className="flex items-start gap-3">
                <div className="grid h-7 w-7 shrink-0 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft">
                  <BarChart3 className="h-3.5 w-3.5" />
                </div>
                <div className="min-w-0">
                  <h4 className="line-clamp-2 text-[13px] font-semibold text-foreground">{a.headline}</h4>
                  <div className="mt-0.5 flex items-center gap-2 text-[10px] uppercase tracking-wide text-muted-soft">
                    <span>{a.source}</span>
                    <span>·</span>
                    <span>{a.date}</span>
                    <span className="rounded-full bg-brand-teal-soft/30 px-1.5 py-px text-[9px]">{a.category}</span>
                  </div>
                </div>
              </div>
            </a>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─── Card primitives ──────────────────────────────────────────────────────

function Card({ children }: { children: React.ReactNode }) {
  return (
    <section className="overflow-hidden rounded-xl border border-border bg-brand-teal-deep/25">
      {children}
    </section>
  );
}

function CardHeader({
  title, eyebrow, description, cta,
}: {
  title: string; eyebrow?: string; description?: string; cta?: React.ReactNode;
}) {
  return (
    <header className="flex items-start justify-between gap-3 border-b border-border/40 px-4 py-3">
      <div>
        {eyebrow && (
          <div className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">{eyebrow}</div>
        )}
        <h2 className="text-base font-bold tracking-tight">{title}</h2>
        {description && (
          <p className="mt-1 max-w-xl text-[12px] text-muted">{description}</p>
        )}
      </div>
      {cta}
    </header>
  );
}

function greeting(hour: number): string {
  if (hour < 5)  return 'evening';
  if (hour < 12) return 'morning';
  if (hour < 17) return 'afternoon';
  return 'evening';
}

// ─── Mock data (replaced by API once wired) ───────────────────────────────


const MOCK_NEWS = [
  { id: 'n1', headline: 'GSA awards $1.2B Alliant 3 IDIQ — full vendor list',         source: 'CaptureRadar',           date: 'May 4, 2026', category: 'Contract Award', url: '#' },
  { id: 'n2', headline: 'DoD FY27 budget signals $14B shift toward AI/ML programs',   source: 'DefenseNews',             date: 'May 3, 2026', category: 'Defense',        url: '#' },
  { id: 'n3', headline: 'CDC NCHHSTP awards 5-year data modernization recompete',     source: 'Federal News Network',    date: 'May 2, 2026', category: 'Civilian',       url: '#' },
  { id: 'n4', headline: 'GAO sustains protest in $400M Veterans Affairs IDIQ award',  source: 'NextGov',                 date: 'May 1, 2026', category: 'Analysis',       url: '#' },
];
