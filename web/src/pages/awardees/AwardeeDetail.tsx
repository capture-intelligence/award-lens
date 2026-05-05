import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Share2, Star, Bell, ShieldCheck, Building2, ExternalLink, BarChart3 } from 'lucide-react';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { FederalAwardAnalysisChart } from '@/components/ui/FederalAwardAnalysisChart';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtMoney } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { toast } from 'sonner';

const PRIMARY_TABS: TabDef[] = [
  { id: 'overview',     label: 'Overview' },
  { id: 'analysis',     label: 'Analysis' },
  { id: 'registration', label: 'Registration' },
  { id: 'people',       label: 'People',       count: 142 },
  { id: 'schedules',    label: 'Schedules',    count: 8 },
  { id: 'vehicles',     label: 'Vehicles',     count: 23 },
  { id: 'idvs',         label: 'IDVs',         count: 412 },
];

const SECONDARY_TABS: TabDef[] = [
  { id: 'contracts',    label: 'Contracts',    count: 8_204 },
  { id: 'subcontracts', label: 'Subcontracts', count: 1_338 },
  { id: 'grants',       label: 'Grants',       count: 38 },
  { id: 'subgrants',    label: 'Subgrants',    count: 4 },
  { id: 'state',        label: 'State',        count: 64 },
  { id: 'nsns',         label: 'NSNs',         count: 1_200 },
  { id: 'partners',     label: 'Partners',     count: 318 },
  { id: 'mentors',      label: 'Mentors',      count: 4 },
  { id: 'jvs',          label: 'JVs',          count: 7 },
  { id: 'additional',   label: 'Additional' },
];

export function AwardeeDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = React.useState('overview');
  const [type, setType] = React.useState<'all'|'contracts'|'grants'>('all');
  const [years, setYears] = React.useState<3|5|10>(5);

  const awardee = MOCK_AWARDEE;

  return (
    <EntityDetailLayout
      back={{ label: 'Awardees', to: routes.awardees }}
      title={awardee.legal_name}
      subtitle={
        <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
          <span>UEI {awardee.uei}</span>
          <span>·</span>
          <span>CAGE {awardee.cage}</span>
          <span>·</span>
          <span>{awardee.hq_city}, {awardee.hq_state}</span>
          <span>·</span>
          <a href={awardee.website} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-vermilion-soft hover:underline">
            {new URL(awardee.website).host} <ExternalLink className="h-3 w-3" />
          </a>
        </span>
      }
      pill={
        awardee.publicly_traded
          ? <span className="rounded-full bg-brand-sage/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-brand-sage ring-1 ring-brand-sage/30">{awardee.exchange}:{awardee.ticker}</span>
          : null
      }
      actions={
        <>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30" onClick={() => toast.info('Share — Phase 1.5')}><Share2 className="h-3.5 w-3.5" /> Share</button>
          <ExportDropdown totalCount={1} tierLimit={20_000} onExport={() => toast.success('Exporting…')} label="Export" />
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30" onClick={() => toast.info('Claim — verification flow opens here')}>
            <ShieldCheck className="h-3.5 w-3.5" /> Claim
          </button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30" onClick={() => toast.info('Favorite added')}><Star className="h-3.5 w-3.5" /></button>
          <button type="button" className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30" onClick={() => toast.info('Notify — alert created')}><Bell className="h-3.5 w-3.5" /></button>
        </>
      }
      primaryTabs={PRIMARY_TABS}
      secondaryTabs={SECONDARY_TABS}
      activeTab={activeTab}
      onTabChange={setActiveTab}
    >
      {activeTab === 'overview' && <OverviewTab awardee={awardee} />}
      {activeTab === 'analysis' && (
        <FederalAwardAnalysisChart
          kpis={MOCK_KPIS}
          trendData={MOCK_TRENDS}
          vehicleRankings={MOCK_VEHICLE_RANKINGS}
          awardeeRankings={MOCK_AWARDEE_RANKINGS}
          type={type}
          onTypeChange={setType}
          years={years}
          onYearsChange={setYears}
          onExport={() => toast.success('Chart export queued')}
        />
      )}
      {activeTab === 'registration' && <RegistrationTab awardee={awardee} />}
      {!['overview','analysis','registration'].includes(activeTab) && (
        <EmptyState
          title="Tab content lands in Phase 1.5."
          message="Schema and indexes already exist for every tab. The TanStack Query hook lands as the API endpoint comes online."
        />
      )}
    </EntityDetailLayout>
  );
}

function OverviewTab({ awardee }: { awardee: typeof MOCK_AWARDEE }) {
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="rounded-xl border border-border bg-brand-teal-deep/25 p-4 lg:col-span-2">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.10em] text-muted-soft">About</h3>
        <p className="mt-2 text-sm leading-relaxed text-foreground">{awardee.description}</p>
        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <KV label="Headquarters" value={`${awardee.hq_city}, ${awardee.hq_state}, ${awardee.hq_country}`} />
          <KV label="Ownership"    value={awardee.publicly_traded ? `${awardee.exchange}:${awardee.ticker}` : 'Private'} />
          <KV label="Founded"      value={String(awardee.founded ?? '—')} />
          <KV label="Primary NAICS" value={`${awardee.primary_naics} — Computer Systems Design Services`} />
          <KV label="Entity structure" value={awardee.entity_structure} />
          <KV label="Employees"    value={awardee.employees ? awardee.employees.toLocaleString() : '—'} />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-brand-teal-deep/25 p-4">
        <h3 className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.10em] text-muted-soft">
          <BarChart3 className="h-3.5 w-3.5" /> Quick stats — FY25
        </h3>
        <ul className="mt-3 flex flex-col gap-2 text-sm">
          <Stat label="Contracts"     value={fmtMoney(MOCK_KPIS.contracts)} />
          <Stat label="Subcontracts"  value={fmtMoney(MOCK_KPIS.subcontracts)} />
          <Stat label="Grants"        value={fmtMoney(MOCK_KPIS.grants)} />
          <Stat label="Subgrants"     value={fmtMoney(MOCK_KPIS.subgrants)} />
          <li className="mt-2 border-t border-border/60 pt-2">
            <Stat label="Total" value={fmtMoney(MOCK_KPIS.contracts + MOCK_KPIS.subcontracts + MOCK_KPIS.grants + MOCK_KPIS.subgrants)} emphasis />
          </li>
        </ul>
      </div>
    </div>
  );
}

function RegistrationTab({ awardee }: { awardee: typeof MOCK_AWARDEE }) {
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="rounded-xl border border-border bg-brand-teal-deep/25 p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.10em] text-muted-soft">SAM.gov registration</h3>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <KV label="Legal name"  value={awardee.legal_name} />
          <KV label="DBA"         value={awardee.dba ?? '—'} />
          <KV label="UEI"         value={<span className="tabular-nums">{awardee.uei}</span>} />
          <KV label="CAGE"        value={<span className="tabular-nums">{awardee.cage}</span>} />
          <KV label="DUNS"        value={<span className="tabular-nums">{awardee.duns ?? '—'}</span>} />
          <KV label="Status"      value="Active" />
        </div>
      </div>
      <div className="rounded-xl border border-border bg-brand-teal-deep/25 p-4">
        <h3 className="text-[11px] font-bold uppercase tracking-[0.10em] text-muted-soft">Certifications</h3>
        <h4 className="mt-3 text-[11px] font-semibold text-muted">SBA</h4>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {awardee.sba_certifications.length ? awardee.sba_certifications.map((c) => (
            <span key={c} className="rounded-full bg-brand-sage/15 px-2 py-0.5 text-[11px] font-medium text-brand-sage ring-1 ring-brand-sage/30">{c}</span>
          )) : <span className="text-sm text-muted-soft">None</span>}
        </div>
        <h4 className="mt-4 text-[11px] font-semibold text-muted">Self-certified</h4>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {awardee.self_certifications.length ? awardee.self_certifications.map((c) => (
            <span key={c} className="rounded-full bg-brand-vermilion/15 px-2 py-0.5 text-[11px] font-medium text-brand-vermilion-soft ring-1 ring-brand-vermilion/30">{c}</span>
          )) : <span className="text-sm text-muted-soft">None</span>}
        </div>
      </div>
    </div>
  );
}

function KV({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div>
      <div className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-soft">{label}</div>
      <div className="mt-0.5 text-sm">{value}</div>
    </div>
  );
}

function Stat({ label, value, emphasis }: { label: string; value: string; emphasis?: boolean }) {
  return (
    <li className={`flex items-center justify-between ${emphasis ? 'font-bold text-foreground' : 'text-muted'}`}>
      <span>{label}</span>
      <span className="tabular-nums">{value}</span>
    </li>
  );
}

const MOCK_AWARDEE = {
  awardee_id: 'a1',
  slug: 'lockheed-martin-corporation',
  legal_name: 'Lockheed Martin Corporation',
  dba: null,
  description: 'Lockheed Martin is a global aerospace, defense, arms, security, and advanced technologies company with worldwide interests. Headquartered in Bethesda, Maryland, the corporation is the largest defense contractor in the world by revenue. Its principal customers are the United States Department of Defense and federal government agencies, with international defense and civilian work supplementing the core US-government revenue.',
  uei: 'KKLPLNS6KCG3',
  cage: '0HSY7',
  duns: '124658923',
  hq_country: 'USA',
  hq_state: 'MD',
  hq_city: 'Bethesda',
  website: 'https://www.lockheedmartin.com',
  publicly_traded: true,
  exchange: 'NYSE',
  ticker: 'LMT',
  founded: 1995,
  entity_structure: 'Corporate',
  employees: 122_000,
  primary_naics: '336411',
  sba_certifications: [],
  self_certifications: ['Large Business'],
};

const MOCK_KPIS = { contracts: 1_018_000_000_000, subcontracts: 18_400_000_000, grants: 432_200_000, subgrants: 87_400_000 };

const MOCK_TRENDS = [
  { year: 2020, contracts: 75_000_000_000, subcontracts: 1_200_000_000, grants: 38_000_000, subgrants: 7_400_000 },
  { year: 2021, contracts: 78_400_000_000, subcontracts: 1_400_000_000, grants: 41_000_000, subgrants: 8_100_000 },
  { year: 2022, contracts: 81_200_000_000, subcontracts: 1_700_000_000, grants: 44_000_000, subgrants: 8_900_000 },
  { year: 2023, contracts: 84_900_000_000, subcontracts: 2_100_000_000, grants: 46_000_000, subgrants: 9_600_000 },
  { year: 2024, contracts: 90_300_000_000, subcontracts: 2_400_000_000, grants: 48_000_000, subgrants: 10_400_000 },
  { year: 2025, contracts: 75_400_000_000, subcontracts: 1_900_000_000, grants: 50_000_000, subgrants: 11_200_000 },
];

const MOCK_VEHICLE_RANKINGS = [
  { rank: 1, name: 'F-35 Joint Program Office',      obligations: 81_000_000_000, pct: 18.3 },
  { rank: 2, name: 'AEGIS Combat System',            obligations: 19_400_000_000, pct: 4.4 },
  { rank: 3, name: 'C-130J Block 8.1',               obligations: 12_800_000_000, pct: 2.9 },
  { rank: 4, name: 'GBSD / LGM-35A Sentinel',        obligations: 11_500_000_000, pct: 2.6 },
  { rank: 5, name: 'PAC-3 Patriot',                  obligations: 9_900_000_000,  pct: 2.2 },
];

const MOCK_AWARDEE_RANKINGS = [
  { rank: 1, name: 'Lockheed Martin Aero',           obligations: 41_200_000_000, pct: 54.6 },
  { rank: 2, name: 'Lockheed Martin Space',          obligations: 14_900_000_000, pct: 19.8 },
  { rank: 3, name: 'Lockheed Martin Missiles',       obligations: 11_300_000_000, pct: 15.0 },
  { rank: 4, name: 'Lockheed Martin Rotary',         obligations: 5_200_000_000,  pct: 6.9 },
  { rank: 5, name: 'Sikorsky Aircraft',              obligations: 2_800_000_000,  pct: 3.7 },
];
