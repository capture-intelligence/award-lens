import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Star, Bell, Building2, ExternalLink } from 'lucide-react';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney, fmtDate } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { api, ApiError } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Federal Awardee — detail page.
 *
 * Wired to GET /vendors/:idOrUei (workers/api), which returns the vendor
 * rollup, any recorded small-business classifications, and the vendor's
 * top awards by value. The investor-demo tabs that ran on fabricated data
 * (analysis charts, people, schedules, vehicles, IDVs, subcontracts,
 * partners, mentors, JVs) are intentionally not shown — they return once
 * those domains are actually ingested rather than presenting invented
 * numbers as real.
 */

const PRIMARY_TABS: TabDef[] = [
  { id: 'overview',        label: 'Overview' },
  { id: 'awards',          label: 'Top awards' },
  { id: 'classifications', label: 'Classifications' },
];

interface VendorRollup {
  vendor_id: string;
  uei: string | null;
  legal_name: string;
  num_awards: number;
  total_value: number;
  first_award_date: string | null;
  last_pop_end: string | null;
}

interface Classification {
  classification: string;
  effective_from: string | null;
  effective_to: string | null;
  source_id: string | null;
}

interface TopAward {
  award_id: string;
  award_piid: string | null;
  current_value: number | null;
  pop_end_date: string | null;
  awarding_org_name: string | null;
}

interface VendorResponse {
  vendor: VendorRollup;
  classifications: Classification[];
  top_awards: TopAward[];
}

export function AwardeeDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = React.useState('overview');
  const [data, setData] = React.useState<VendorResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    api
      .get<VendorResponse>(`/vendors/${encodeURIComponent(slug)}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => {
        if (alive) setError(
          e instanceof ApiError
            ? (e.status === 404 ? 'This awardee is not in the warehouse.' : `Couldn't load it (API ${e.status}).`)
            : "Couldn't load this awardee.",
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  if (loading) {
    return <div className="p-8 text-sm text-muted">Loading awardee…</div>;
  }
  if (error || !data || !data.vendor) {
    return (
      <div className="p-8">
        <EmptyState icon={Building2} title="Couldn't load this awardee." message={error ?? 'Unknown error.'} />
      </div>
    );
  }

  const v = data.vendor;

  return (
    <EntityDetailLayout
      back={{ label: 'Awardees', to: routes.awardees }}
      title={v.legal_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>UEI {v.uei ?? '—'}</span>
          <span>·</span>
          <span>{(v.num_awards ?? 0).toLocaleString()} awards</span>
          <span>·</span>
          <span>{fmtMoney(v.total_value)} obligated</span>
        </span>
      }
      actions={
        <>
          <IconButton icon={Star} label="Favorite" />
          <IconButton icon={Bell} label="Notify" />
        </>
      }
      primaryTabs={PRIMARY_TABS}
      secondaryTabs={[]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'overview' && <OverviewTab v={v} />}
      {activeTab === 'awards' && <AwardsTab awards={data.top_awards ?? []} />}
      {activeTab === 'classifications' && <ClassificationsTab rows={data.classifications ?? []} />}
    </EntityDetailLayout>
  );
}

function IconButton({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30"
      onClick={() => toast.info(`${label} — coming soon`)}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

function OverviewTab({ v }: { v: VendorRollup }) {
  return (
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      <KV label="Legal name"   value={v.legal_name} />
      <KV label="UEI"          value={<span className="tabular-nums">{v.uei ?? '—'}</span>} />
      <KV label="Awards"       value={(v.num_awards ?? 0).toLocaleString()} />
      <KV label="Total obligated" value={fmtMoney(v.total_value)} />
      <KV label="First award"  value={v.first_award_date ? fmtDate(v.first_award_date) : '—'} />
      <KV label="Last activity" value={v.last_pop_end ? fmtDate(v.last_pop_end) : '—'} />
    </div>
  );
}

function AwardsTab({ awards }: { awards: TopAward[] }) {
  if (awards.length === 0) {
    return <EmptyState icon={Building2} title="No awards on record." message="This vendor has no awards in the warehouse yet." />;
  }
  return (
    <ul className="flex flex-col gap-2">
      {awards.map((a) => (
        <li key={a.award_id} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <div className="min-w-0">
            <div className="truncate text-sm font-semibold text-foreground">{a.award_piid ?? a.award_id}</div>
            <div className="mt-0.5 text-[11px] text-muted-soft">
              {a.awarding_org_name ?? 'Unknown agency'}
              {a.pop_end_date && <> · ends {fmtDate(a.pop_end_date)}</>}
            </div>
          </div>
          <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{a.current_value != null ? fmtMoney(a.current_value) : '—'}</div>
        </li>
      ))}
    </ul>
  );
}

function ClassificationsTab({ rows }: { rows: Classification[] }) {
  if (rows.length === 0) {
    return (
      <EmptyState
        icon={Building2}
        title="No classifications recorded."
        message="This vendor has no small-business or set-aside classifications in the warehouse."
      />
    );
  }
  return (
    <ul className="flex flex-col gap-2">
      {rows.map((r, i) => (
        <li key={`${r.classification}-${i}`} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <span className="rounded-full bg-brand-sage/15 px-2 py-0.5 text-[11px] font-medium text-brand-sage ring-1 ring-brand-sage/30">{r.classification}</span>
          <span className="flex items-center gap-2 text-[11px] text-muted-soft">
            {r.effective_from ? fmtDate(r.effective_from) : '—'} → {r.effective_to ? fmtDate(r.effective_to) : 'current'}
            {r.source_id && <span className="inline-flex items-center gap-1"><ExternalLink className="h-3 w-3" />{r.source_id}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="border-b border-border/40 pb-2">
      <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-soft">{label}</div>
      <div className="mt-1 text-sm text-foreground">{value}</div>
    </div>
  );
}
