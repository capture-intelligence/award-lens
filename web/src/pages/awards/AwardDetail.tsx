import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Award as AwardIcon, Share2, Bell, Building2, Sparkles } from 'lucide-react';
import { FavoriteStar } from '@/components/FavoriteStar';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { api, ApiError } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Federal Contract Award — detail page.
 *
 * Wired to GET /awards/:id (workers/api → v_award_current, USAspending prime
 * awards). Null-safe throughout. The vendor links through to the awardee
 * detail page.
 */

const TABS: TabDef[] = [
  { id: 'overview',    label: 'Overview' },
  { id: 'description', label: 'Description' },
];

interface AwardDetail {
  award_id: string;
  award_piid: string | null;
  award_type: string | null;
  description: string | null;
  current_value: number | null;
  obligated_amount: number | null;
  pop_start_date: string | null;
  pop_end_date: string | null;
  naics_code: string | null;
  psc_code: string | null;
  vendor_id: string | null;
  vendor_name: string | null;
  vendor_uei: string | null;
  vendor_state: string | null;
  awarding_org_name: string | null;
  days_to_expiry: number | null;
}

export function AwardDetailPage() {
  const { id } = useParams<{ id: string }>();
  const [activeTab, setActiveTab] = React.useState('overview');
  const [data, setData] = React.useState<AwardDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!id) return;
    let alive = true;
    setLoading(true);
    api
      .get<AwardDetail>(`/awards/${encodeURIComponent(id)}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => {
        if (alive) setError(
          e instanceof ApiError
            ? (e.status === 404 ? 'This award is no longer in the warehouse.' : `Couldn't load it (API ${e.status}).`)
            : "Couldn't load this award.",
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [id]);

  if (loading) return <div className="p-8 text-sm text-muted">Loading award…</div>;
  if (error || !data || !data.award_id) {
    return (
      <div className="p-8">
        <EmptyState icon={AwardIcon} title="Couldn't load this award." message={error ?? 'Unknown error.'} />
      </div>
    );
  }

  const a = data;
  const isActive = !!a.pop_end_date && new Date(a.pop_end_date) >= new Date();

  return (
    <EntityDetailLayout
      back={{ label: 'Contract Awards', to: routes.contractAwards }}
      title={a.award_piid ?? a.award_id}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>{a.vendor_name ?? '(unknown vendor)'}</span>
          <span>·</span>
          <span className="truncate">{a.awarding_org_name ?? '—'}</span>
        </span>
      }
      pill={
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${isActive ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' : 'bg-muted/15 text-muted ring-border'}`}>
          {isActive ? 'Active' : 'Ended'}
        </span>
      }
      actions={
        <>
          <IconButton icon={Share2} label="Share" />
          <FavoriteStar entity_type="award" entity_id={a.award_id} />
          <IconButton icon={Bell}   label="Notify" />
        </>
      }
      primaryTabs={TABS}
      secondaryTabs={[]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'overview' && <OverviewTab a={a} isActive={isActive} />}
      {activeTab === 'description' && (
        a.description ? (
          <div className="max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed text-foreground">{a.description}</div>
        ) : (
          <EmptyState icon={Sparkles} title="No description." message="USAspending didn't include an award description for this record." />
        )
      )}
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

function OverviewTab({ a, isActive }: { a: AwardDetail; isActive: boolean }) {
  return (
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      <KV label="PIID"            value={<span className="tabular-nums">{a.award_piid ?? '—'}</span>} />
      <KV label="Award type"      value={a.award_type ?? '—'} />
      <KV
        label="Vendor"
        value={a.vendor_id
          ? <Link to={`/awardee/${a.vendor_id}`} className="inline-flex items-center gap-1.5 text-brand-vermilion-soft hover:underline"><Building2 className="h-3.5 w-3.5" />{a.vendor_name ?? a.vendor_id}</Link>
          : (a.vendor_name ?? '—')}
      />
      <KV label="Vendor UEI"      value={<span className="tabular-nums">{a.vendor_uei ?? '—'}</span>} />
      <KV label="Vendor state"    value={a.vendor_state ?? '—'} />
      <KV label="Awarding agency" value={a.awarding_org_name ?? '—'} />
      <KV label="Current value"   value={a.current_value != null ? fmtMoney(a.current_value) : '—'} />
      <KV label="Obligated"       value={a.obligated_amount != null ? fmtMoney(a.obligated_amount) : '—'} />
      <KV label="Period of performance" value={`${a.pop_start_date ? fmtDate(a.pop_start_date) : '—'} → ${a.pop_end_date ? fmtDate(a.pop_end_date) : '—'}`} />
      <KV label="Status"          value={isActive ? `Active${a.days_to_expiry != null ? ` · ${a.days_to_expiry}d to expiry` : ''}` : 'Ended'} />
      <KV label="NAICS"           value={a.naics_code ?? '—'} />
      <KV label="PSC"             value={a.psc_code ?? '—'} />
    </div>
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
