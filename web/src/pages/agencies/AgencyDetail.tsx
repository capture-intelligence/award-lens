import * as React from 'react';
import { Link, useParams } from 'react-router-dom';
import { Landmark, Building2, Award as AwardIcon } from 'lucide-react';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { api, ApiError } from '@/lib/api';

/**
 * Federal Agency — detail page.
 *
 * Wired to GET /organizations/:id (workers/api): the awarding organization plus
 * its top awards and top vendors by obligated value. Awards link to the award
 * detail; vendors link to the awardee detail.
 */

const TABS: TabDef[] = [
  { id: 'awards',  label: 'Top awards' },
  { id: 'vendors', label: 'Top vendors' },
];

interface TopAward {
  award_id: string;
  award_piid: string | null;
  award_type: string | null;
  vendor_name: string | null;
  current_value: number | null;
  pop_end_date: string | null;
}
interface TopVendor {
  vendor_id: string | null;
  vendor_name: string | null;
  num_awards: number;
  total_value: number;
}
interface OrgResponse {
  organization: {
    org_id: string;
    canonical_name: string;
    short_name: string | null;
    org_type: string | null;
    num_awards: number;
    total_value: number;
  };
  top_awards: TopAward[];
  top_vendors: TopVendor[];
}

export function AgencyDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = React.useState('awards');
  const [data, setData] = React.useState<OrgResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    api
      .get<OrgResponse>(`/organizations/${encodeURIComponent(slug)}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => {
        if (alive) setError(
          e instanceof ApiError
            ? (e.status === 404 ? 'This agency is not in the warehouse.' : `Couldn't load it (API ${e.status}).`)
            : "Couldn't load this agency.",
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  if (loading) return <div className="p-8 text-sm text-muted">Loading agency…</div>;
  if (error || !data || !data.organization) {
    return (
      <div className="p-8">
        <EmptyState icon={Landmark} title="Couldn't load this agency." message={error ?? 'Unknown error.'} />
      </div>
    );
  }

  const o = data.organization;

  return (
    <EntityDetailLayout
      back={{ label: 'Agencies', to: routes.agencies }}
      title={o.canonical_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          {o.short_name && <><span>{o.short_name}</span><span>·</span></>}
          <span>{o.org_type ?? '—'}</span>
          <span>·</span>
          <span>{o.num_awards.toLocaleString()} awards</span>
          <span>·</span>
          <span>{fmtMoney(o.total_value)} obligated</span>
        </span>
      }
      actions={null}
      primaryTabs={TABS}
      secondaryTabs={[]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'awards' && <AwardsTab awards={data.top_awards ?? []} />}
      {activeTab === 'vendors' && <VendorsTab vendors={data.top_vendors ?? []} />}
    </EntityDetailLayout>
  );
}

function AwardsTab({ awards }: { awards: TopAward[] }) {
  if (awards.length === 0) return <EmptyState icon={AwardIcon} title="No awards on record." message="This agency has no awards in the warehouse yet." />;
  return (
    <ul className="flex flex-col gap-2">
      {awards.map((a) => (
        <li key={a.award_id} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <div className="min-w-0">
            <Link to={`/award/contract/prime/${a.award_id}`} className="block truncate text-sm font-semibold text-foreground hover:text-brand-vermilion-soft hover:underline">{a.award_piid ?? a.award_id}</Link>
            <div className="mt-0.5 text-[11px] text-muted-soft">
              {a.vendor_name ?? 'Unknown vendor'}
              {a.pop_end_date && <> · ends {fmtDate(a.pop_end_date)}</>}
            </div>
          </div>
          <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{a.current_value != null ? fmtMoney(a.current_value) : '—'}</div>
        </li>
      ))}
    </ul>
  );
}

function VendorsTab({ vendors }: { vendors: TopVendor[] }) {
  if (vendors.length === 0) return <EmptyState icon={Building2} title="No vendors on record." message="This agency has no vendors in the warehouse yet." />;
  return (
    <ul className="flex flex-col gap-2">
      {vendors.map((v, i) => (
        <li key={v.vendor_id ?? i} className="flex items-start justify-between gap-4 rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <div className="min-w-0">
            {v.vendor_id
              ? <Link to={`/awardee/${v.vendor_id}`} className="block truncate text-sm font-semibold text-foreground hover:text-brand-vermilion-soft hover:underline">{v.vendor_name ?? v.vendor_id}</Link>
              : <span className="block truncate text-sm font-semibold text-foreground">{v.vendor_name ?? '—'}</span>}
            <div className="mt-0.5 text-[11px] text-muted-soft">{(v.num_awards ?? 0).toLocaleString()} awards</div>
          </div>
          <div className="shrink-0 text-sm font-semibold tabular-nums text-foreground">{fmtMoney(v.total_value)}</div>
        </li>
      ))}
    </ul>
  );
}
