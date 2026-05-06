import * as React from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import {
  ArrowRight, Calendar, FileText, Award, Users,
  Bell, BarChart3, Plus,
} from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { TextSnapshot } from '@/components/ui/TextSnapshot';
import { AIBadge } from '@/components/ui/AISummaryToggle';
import { useAuth } from '@/lib/auth-context';
import { routes } from '@/lib/routes';
import { fmtDate, fmtMoney } from '@/lib/utils';

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
 * Phase 1 ships with mock data so investors / customers see a populated
 * page; the API hooks come online as ingestion runs land. Each section is
 * already wired to the corresponding route — clicking through goes to the
 * full list view.
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

      {/* KPI strip */}
      <KPIStrip />

      {/* Two-column main */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <RecommendedOpportunities />
          <CalendarWidget />
        </div>
        <div className="flex flex-col gap-6">
          <OpenActivities />
          <NewsWidget />
        </div>
      </div>
    </div>
  );
}

// ─── KPI strip ─────────────────────────────────────────────────────────────
function KPIStrip() {
  // Mock data — wire to /v1/dashboard/kpis once API ships.
  const kpis = [
    { label: 'Active opportunities', value: '78,412', delta: '+1,204 this week', icon: FileText, color: 'text-brand-vermilion-soft' },
    { label: 'Awards FY25',           value: '$487B',  delta: 'tracking 50 agencies',  icon: Award,    color: 'text-brand-sage' },
    { label: 'Awardees indexed',      value: '82,103', delta: 'with profile vectors',   icon: Users,    color: 'text-foreground' },
    { label: 'Saved searches firing', value: '0',      delta: 'create your first',      icon: Bell,     color: 'text-muted' },
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

// ─── Recommended opportunities ─────────────────────────────────────────────
function RecommendedOpportunities() {
  // Mock recs — wire to /v1/recommendations/opportunities once embeddings job runs.
  const recs = MOCK_OPPS;
  return (
    <Card>
      <CardHeader
        title="Recommended for you"
        eyebrow="AI Curated"
        description="Ranked by similarity to your saved searches, NAICS profile, and pursuit history."
        cta={<Link to={routes.contractOpps} className="inline-flex items-center gap-1 text-[12px] text-muted-soft hover:text-foreground">
          See all <ArrowRight className="h-3 w-3" />
        </Link>}
      />
      <ul className="flex flex-col divide-y divide-border/50">
        {recs.map((o) => (
          <li key={o.opportunity_id} className="group">
            <Link
              to={`/opportunity/contract/${o.slug}`}
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
                    <span className="shrink-0 rounded-full bg-brand-sage/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-sage">
                      {o.match_pct}% match
                    </span>
                  </div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-soft">
                    <span>{o.agency}</span>
                    <span>·</span>
                    <span>NAICS {o.naics}</span>
                    <span>·</span>
                    <span>{o.set_aside}</span>
                    <span>·</span>
                    <span>Due {fmtDate(o.deadline)}</span>
                    {o.ai_value_min && (
                      <>
                        <span>·</span>
                        <span className="inline-flex items-center gap-1">
                          <AIBadge label="value" />
                          {fmtMoney(o.ai_value_min)} – {fmtMoney(o.ai_value_max)}
                        </span>
                      </>
                    )}
                  </div>
                  <TextSnapshot text={o.summary} />
                </div>
              </div>
            </Link>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ─── Calendar widget ──────────────────────────────────────────────────────
function CalendarWidget() {
  return (
    <Card>
      <CardHeader
        title="Business Development Calendar"
        eyebrow="Upcoming"
        description="Solicitation deadlines, pursuit milestones, and pipeline review dates."
        cta={<Link to={routes.activities} className="inline-flex items-center gap-1 text-[12px] text-muted-soft hover:text-foreground">
          Open calendar <ArrowRight className="h-3 w-3" />
        </Link>}
      />
      <div className="px-4 pb-4">
        <MiniCalendar />
      </div>
    </Card>
  );
}

function MiniCalendar() {
  const days = Array.from({ length: 35 }, (_, i) => i - 3);  // simple 5x7 grid
  const today = new Date().getDate();
  return (
    <div className="grid grid-cols-7 gap-px overflow-hidden rounded-lg border border-border/60 bg-border/30 text-[11px]">
      {['S','M','T','W','T','F','S'].map((d, i) => (
        <div key={i} className="bg-brand-teal-deep/85 px-2 py-1.5 text-center font-bold uppercase tracking-wider text-muted-soft">
          {d}
        </div>
      ))}
      {days.map((d, i) => {
        const inMonth = d > 0 && d <= 30;
        const isToday = d === today;
        const hasEvent = inMonth && [3, 7, 11, 14, 18, 22, 25, 28].includes(d);
        return (
          <div
            key={i}
            className={`min-h-[60px] bg-brand-teal-deep/35 p-1.5 ${!inMonth && 'opacity-40'} ${isToday && 'ring-2 ring-inset ring-brand-vermilion'}`}
          >
            <div className={`text-[10px] font-semibold ${isToday ? 'text-brand-vermilion-soft' : 'text-foreground'}`}>
              {inMonth ? d : ''}
            </div>
            {hasEvent && (
              <div className="mt-1 truncate rounded bg-brand-vermilion/20 px-1 py-px text-[9px] text-brand-vermilion-soft">
                Solicit. due
              </div>
            )}
          </div>
        );
      })}
    </div>
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
        eyebrow="Insights"
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

const MOCK_OPPS = [
  {
    opportunity_id: 'opp-1',
    slug: 'cdc-data-platform-modernization-fy26',
    title: 'CDC Data Platform Modernization — FY26 Phase II',
    agency: 'Centers for Disease Control and Prevention',
    naics: '541512',
    set_aside: '8(a)',
    deadline: '2026-06-15',
    match_pct: 91,
    ai_value_min: 12_000_000,
    ai_value_max: 24_000_000,
    summary: 'Multi-year IDIQ for cloud-native data engineering supporting NCHHSTP surveillance dashboards. Period of performance includes one base year plus four option years; emphasis on Snowflake/Databricks expertise and HIPAA-aligned data handling.',
  },
  {
    opportunity_id: 'opp-2',
    slug: 'army-amc-aviation-logistics-bpa',
    title: 'AMC Aviation Logistics Support BPA',
    agency: 'U.S. Army Materiel Command',
    naics: '336411',
    set_aside: 'SDVOSB',
    deadline: '2026-05-28',
    match_pct: 84,
    ai_value_min: 45_000_000,
    ai_value_max: 90_000_000,
    summary: 'Blanket Purchase Agreement covering rotary-wing logistics, MRO scheduling, and supply-chain analytics for the AMC enterprise. Vendor must hold AS9100D certification and demonstrate prior depot-level work.',
  },
  {
    opportunity_id: 'opp-3',
    slug: 'va-tele-mental-health-platform',
    title: 'VA Tele-Mental Health Platform — Recompete',
    agency: 'Department of Veterans Affairs',
    naics: '622310',
    set_aside: 'WOSB',
    deadline: '2026-07-02',
    match_pct: 78,
    ai_value_min: 6_500_000,
    ai_value_max: 15_000_000,
    summary: 'Recompete of FY21 VA tele-health program. Incumbent transitions; agency seeks reduced provider-to-veteran latency, FedRAMP High posture, and integration with VistA Evolution.',
  },
  {
    opportunity_id: 'opp-4',
    slug: 'dhs-border-imagery-analytics',
    title: 'DHS Border Imagery Analytics — Special Notice',
    agency: 'Department of Homeland Security',
    naics: '541715',
    set_aside: 'None',
    deadline: '2026-08-19',
    match_pct: 72,
    ai_value_min: 100_000_000,
    ai_value_max: 250_000_000,
    summary: 'Pre-solicitation special notice for ML-driven imagery analytics across CBP southern-border sensor towers. Focus on edge inference and on-device redaction; classified annex available to cleared bidders.',
  },
];

const MOCK_NEWS = [
  { id: 'n1', headline: 'GSA awards $1.2B Alliant 3 IDIQ — full vendor list',         source: 'CaptureRadar',           date: 'May 4, 2026', category: 'Contract Award', url: '#' },
  { id: 'n2', headline: 'DoD FY27 budget signals $14B shift toward AI/ML programs',   source: 'DefenseNews',             date: 'May 3, 2026', category: 'Defense',        url: '#' },
  { id: 'n3', headline: 'CDC NCHHSTP awards 5-year data modernization recompete',     source: 'Federal News Network',    date: 'May 2, 2026', category: 'Civilian',       url: '#' },
  { id: 'n4', headline: 'GAO sustains protest in $400M Veterans Affairs IDIQ award',  source: 'NextGov',                 date: 'May 1, 2026', category: 'Analysis',       url: '#' },
];
