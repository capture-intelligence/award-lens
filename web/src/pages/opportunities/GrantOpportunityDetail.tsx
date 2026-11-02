import * as React from 'react';
import { useParams } from 'react-router-dom';
import { ExternalLink, BookOpen, Share2, Bell, Sparkles } from 'lucide-react';
import { FavoriteStar } from '@/components/FavoriteStar';
import { AddToPipelineButton } from '@/components/AddToPipelineButton';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { api, ApiError } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Federal Grant Opportunity — detail page.
 *
 * Wired to GET /opportunities/:id (workers/api → grant_opportunity, Grants.gov).
 * Grants.gov data is sparse on many fields, so everything renders null-safe
 * ("—"). Two tabs: Description (the synopsis text) and Overview (metadata).
 */

const TABS: TabDef[] = [
  { id: 'description', label: 'Description' },
  { id: 'overview',    label: 'Overview' },
];

interface GrantDetail {
  opportunity_id: string;
  opportunity_number: string | null;
  title: string;
  agency_code: string | null;
  agency_name: string | null;
  category: string | null;
  funding_instrument: string | null;
  assistance_listings: string | null;
  posted_date: string | null;
  close_date: string | null;
  archive_date: string | null;
  est_total_funding: number | null;
  award_ceiling: number | null;
  award_floor: number | null;
  expected_awards: number | null;
  eligibility_codes: string | null;
  description: string | null;
  status: string | null;
  opportunity_url: string | null;
  doc_type: string | null;
}

export function GrantOpportunityDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = React.useState('description');
  const [data, setData] = React.useState<GrantDetail | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    api
      .get<GrantDetail>(`/opportunities/${encodeURIComponent(slug)}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => {
        if (alive) setError(
          e instanceof ApiError
            ? (e.status === 404 ? 'This grant is no longer in the warehouse.' : `Couldn't load it (API ${e.status}).`)
            : "Couldn't load this grant.",
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  if (loading) return <div className="p-8 text-sm text-muted">Loading grant…</div>;
  if (error || !data || !data.opportunity_id) {
    return (
      <div className="p-8">
        <EmptyState icon={BookOpen} title="Couldn't load this grant." message={error ?? 'Unknown error.'} />
      </div>
    );
  }

  const g = data;
  const agency = g.agency_name ?? g.agency_code ?? '—';
  const isOpen = !!g.close_date && new Date(g.close_date) >= new Date();

  return (
    <EntityDetailLayout
      back={{ label: 'Grant Opportunities', to: routes.grantOpps }}
      title={g.title}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>{g.opportunity_number ?? '(no number)'}</span>
          <span>·</span>
          <span className="truncate">{agency}</span>
        </span>
      }
      pill={
        <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${isOpen ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' : 'bg-muted/15 text-muted ring-border'}`}>
          {isOpen ? 'Open' : (g.status ?? 'Closed')}
        </span>
      }
      actions={
        <>
          <IconButton icon={Share2} label="Share" />
          <FavoriteStar entity_type="grant" entity_id={g.opportunity_id} />
          <AddToPipelineButton entity_type="grant" entity_id={g.opportunity_id} title={g.title} />
          <IconButton icon={Bell}   label="Notify" />
        </>
      }
      primaryTabs={TABS}
      secondaryTabs={[]}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'description' && (
        g.description ? (
          <div className="max-w-[72ch] whitespace-pre-wrap text-sm leading-relaxed text-foreground">{g.description}</div>
        ) : (
          <EmptyState icon={Sparkles} title="No synopsis provided." message="Grants.gov didn't include a description for this opportunity. Use the Grants.gov link in Overview for the full posting." />
        )
      )}
      {activeTab === 'overview' && <OverviewTab g={g} agency={agency} isOpen={isOpen} />}
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

function OverviewTab({ g, agency, isOpen }: { g: GrantDetail; agency: string; isOpen: boolean }) {
  const listings = (g.assistance_listings ?? '').split('|').filter(Boolean);
  return (
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      <KV label="Agency"            value={agency} />
      <KV label="Opportunity number" value={g.opportunity_number ?? '—'} />
      <KV label="Status"            value={isOpen ? 'Open' : (g.status ?? '—')} />
      <KV label="Category"          value={g.category ?? '—'} />
      <KV label="Funding instrument" value={g.funding_instrument ?? '—'} />
      <KV label="Doc type"          value={g.doc_type ?? '—'} />
      <KV label="Posted"            value={g.posted_date ? fmtDate(g.posted_date) : '—'} />
      <KV label="Closes"            value={g.close_date ? fmtDate(g.close_date) : '—'} />
      <KV label="Archive date"      value={g.archive_date ? fmtDate(g.archive_date) : '—'} />
      <KV label="Est. total funding" value={g.est_total_funding != null ? fmtMoney(g.est_total_funding) : '—'} />
      <KV label="Award ceiling"     value={g.award_ceiling != null ? fmtMoney(g.award_ceiling) : '—'} />
      <KV label="Award floor"       value={g.award_floor != null ? fmtMoney(g.award_floor) : '—'} />
      <KV label="Expected awards"   value={g.expected_awards != null ? g.expected_awards.toLocaleString() : '—'} />
      <KV label="Eligibility codes" value={g.eligibility_codes ?? '—'} />
      <KV
        label="Assistance listings"
        value={listings.length ? <span className="flex flex-wrap gap-1.5">{listings.map((l) => <span key={l} className="rounded-full bg-brand-teal-soft/20 px-2 py-0.5 text-[11px] text-muted">{l}</span>)}</span> : '—'}
      />
      <KV
        label="Source"
        value={g.opportunity_url
          ? <a href={g.opportunity_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-vermilion-soft hover:underline">Grants.gov <ExternalLink className="h-3 w-3" /></a>
          : '—'}
      />
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
