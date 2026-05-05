import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Share2, Download, ThumbsDown, Star, Bell, ExternalLink, Sparkles, MapPin, FileText, Loader2 } from 'lucide-react';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { AISummaryToggle, AIBadge } from '@/components/ui/AISummaryToggle';
import { TextSnapshot } from '@/components/ui/TextSnapshot';
import { EmptyState } from '@/components/ui/EmptyState';
import { PipelineDropdown } from '@/components/ui/PipelineDropdown';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { AIAssistantChat } from '@/components/ui/AIAssistantChat';
import { fmtDate, fmtMoney } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { toast } from 'sonner';

/**
 * Federal Contract Opportunity — detail page (spec §3.2). 15 tabs covering
 * Description, Overview, Contacts, Docs, Assistant, Lifecycle, Awards, IDVs,
 * Contracts, Protests, Incumbents, Bidders, Similar, Experts, Additional.
 *
 * This is the most-clicked detail surface in HigherGov per the audit. Phase
 * 0 ships a complete shell using mock data so investors can navigate the
 * full UX before ingestion runs.
 */

const PRIMARY_TABS: TabDef[] = [
  { id: 'description', label: 'Description' },
  { id: 'overview',    label: 'Overview' },
  { id: 'contacts',    label: 'Contacts',  count: 2 },
  { id: 'docs',        label: 'Docs',      count: 4 },
  { id: 'assistant',   label: 'Assistant' },
  { id: 'lifecycle',   label: 'Lifecycle' },
  { id: 'awards',      label: 'Awards',    count: 0 },
];

const SECONDARY_TABS: TabDef[] = [
  { id: 'idvs',        label: 'IDVs',        count: 1 },
  { id: 'contracts',   label: 'Contracts',   count: 0 },
  { id: 'protests',    label: 'Protests',    count: 0 },
  { id: 'incumbents',  label: 'Incumbents',  count: 12 },
  { id: 'bidders',     label: 'Bidders',     count: 28 },
  { id: 'similar',     label: 'Similar',     count: 7 },
  { id: 'experts',     label: 'Experts',     count: 5 },
  { id: 'additional',  label: 'Additional' },
];

export function ContractOpportunityDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = React.useState('overview');

  // Mock data → replace with useQuery on /opportunities/contract/:slug
  const opp = MOCK_OPP;

  return (
    <>
      <EntityDetailLayout
        back={{ label: 'Contract Opportunities', to: routes.contractOpps }}
        title={opp.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{opp.solicitation_number}</span>
            <span>·</span>
            <span>{opp.agency}</span>
            <span>·</span>
            <span>NAICS {opp.naics}</span>
          </span>
        }
        pill={
          <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-emerald-400 ring-1 ring-emerald-500/30">
            {opp.is_active ? 'Active' : 'Closed'}
          </span>
        }
        actions={
          <>
            <IconButton icon={Share2}    label="Share" />
            <ExportDropdown totalCount={1} tierLimit={20_000} onExport={() => toast.success('Exporting…')} label="Export" />
            <IconButton icon={ThumbsDown} label="No bid" />
            <IconButton icon={Star}       label="Favorite" />
            <IconButton icon={Bell}       label="Notify" />
            <PipelineDropdown
              pipelines={[
                { pipeline_id: 'p1', title: 'CDC Q3 capture' },
                { pipeline_id: 'p2', title: 'Defense IT recompetes' },
              ]}
              onSelect={async (id) => toast.success(`Added to pipeline ${id}`)}
              onCreateNew={() => toast.info('New pipeline modal opens here')}
            />
          </>
        }
        primaryTabs={PRIMARY_TABS}
        secondaryTabs={SECONDARY_TABS}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === 'description' && (
          <AISummaryToggle
            original={opp.description}
            summary={opp.description_summary}
            defaultMode="summary"
          />
        )}
        {activeTab === 'overview' && <OverviewTab opp={opp} />}
        {activeTab === 'contacts' && <ContactsTab />}
        {activeTab === 'docs' && <DocsTab />}
        {activeTab === 'assistant' && (
          <EmptyState
            icon={Sparkles}
            title="Use the floating ✦ assistant button."
            message="The Opportunity Assistant has full RAG context over this solicitation, all attachments, and related awards/incumbents/bidders. Open it via the bottom-right launcher."
          />
        )}
        {activeTab === 'incumbents' && <IncumbentsTab />}
        {activeTab === 'bidders'    && <BiddersTab />}
        {activeTab === 'similar'    && <SimilarTab />}
        {activeTab === 'experts'    && <ExpertsTab />}
        {(activeTab === 'lifecycle' || activeTab === 'awards' || activeTab === 'idvs' || activeTab === 'contracts' || activeTab === 'protests' || activeTab === 'additional') && (
          <EmptyState
            title="Tab content lands in Phase 1.5."
            message="Each tab loads its own data via TanStack Query. Schema and indexes already exist; the per-tab API route ships next."
          />
        )}
      </EntityDetailLayout>

      {/* Floating opportunity assistant */}
      <AIAssistantChat
        title="Opportunity Assistant"
        context={{ kind: 'opportunity', id: opp.opportunity_id, title: opp.title }}
        suggestedPrompts={[
          'Who are the most likely incumbents for this work?',
          'Summarize the reporting requirements across all attachments.',
          'What's the realistic value range based on similar past awards?',
          'Which past CDC NCHHSTP awards are closest in scope?',
        ]}
        onSendMessage={async (text) => {
          // Phase 0 — return a canned response. Phase 1 wires to /v1/ai/chat
          // streaming endpoint backed by Workers AI.
          await new Promise((r) => setTimeout(r, 600));
          return { content: `_(demo response)_ I can answer "${text}" once the AI chat endpoint is wired in Phase 1.5. The ingestion job will populate the vector index with this solicitation's full attachment text first.` };
        }}
      />
    </>
  );
}

// ─── Action bar buttons ───────────────────────────────────────────────────
function IconButton({ icon: Icon, label }: { icon: React.ComponentType<{ className?: string }>; label: string }) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30"
      onClick={() => toast.info(`${label} — Phase 1.5 wires this`)}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// ─── Overview tab ─────────────────────────────────────────────────────────
function OverviewTab({ opp }: { opp: typeof MOCK_OPP }) {
  return (
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      <KV label="Agency"             value={<span>{opp.agency}</span>} />
      <KV label="Response deadline"  value={
        <span className="inline-flex items-center gap-2">
          {fmtDate(opp.response_deadline)}
          <span className="rounded bg-emerald-500/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-wider text-emerald-400">
            <AIBadge label="DUE IN 41 DAYS" />
          </span>
        </span>
      } />
      <KV label="Posted"             value={fmtDate(opp.posted_at)} />
      <KV label="Set aside"          value={opp.set_aside} />
      <KV label="NAICS"              value={`${opp.naics} — Computer Systems Design Services`} />
      <KV label="PSC"                value={`${opp.psc} — IT Application Development`} />
      <KV label="Place of performance" value={
        <span className="inline-flex items-center gap-1.5">
          <MapPin className="h-3.5 w-3.5 text-muted-soft" />
          Atlanta, GA 30329 · United States
        </span>
      } />
      <KV label="Source"             value={
        <a href={opp.source_url} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-vermilion-soft hover:underline">
          SAM.gov <ExternalLink className="h-3 w-3" />
        </a>
      } />
      <KV label="SBA size standard"  value="$34 million (revenue)" />
      <KV label="Pricing" value={
        <span className="inline-flex items-center gap-1.5">
          <AIBadge label="AI" />
          Likely Fixed Price
        </span>
      } />
      <KV label="Estimated value range" value={
        <span className="inline-flex items-center gap-1.5">
          <AIBadge label="AI" />
          {fmtMoney(opp.ai_value_min)} – {fmtMoney(opp.ai_value_max)}
        </span>
      } />
      <KV label="Vehicle type"       value="Blanket Purchase Agreement (BPA)" />
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

// ─── Contacts tab ─────────────────────────────────────────────────────────
function ContactsTab() {
  return (
    <ul className="flex flex-col gap-3">
      {[
        { name: 'M. Henderson', title: 'Contracting Officer',       email: 'mhenderson@cdc.hhs.gov',      phone: '+1 404 555 0142' },
        { name: 'L. Vasquez',   title: 'Contracting Specialist',    email: 'lvasquez@cdc.hhs.gov',        phone: '+1 404 555 0188' },
      ].map((c) => (
        <li key={c.email} className="rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <div className="flex items-start justify-between gap-3">
            <div>
              <div className="font-semibold">{c.name}</div>
              <div className="text-[12px] text-muted-soft">{c.title}</div>
              <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] text-muted">
                <a href={`mailto:${c.email}`} className="text-brand-vermilion-soft hover:underline">{c.email}</a>
                <span>·</span>
                <span>{c.phone}</span>
              </div>
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Docs tab ─────────────────────────────────────────────────────────────
function DocsTab() {
  return (
    <ul className="flex flex-col gap-3">
      {[
        { name: 'PWS_Statement_of_Work.pdf', size: '1.2 MB', posted: '2026-04-12', snapshot: 'The contractor shall provide cloud-native data engineering services supporting the NCHHSTP surveillance dashboards. Section 4.2 mandates HIPAA-aligned data handling and FedRAMP Moderate posture.' },
        { name: 'QASP_Quality_Plan.pdf',     size: '0.4 MB', posted: '2026-04-12', snapshot: 'Quality Assurance Surveillance Plan establishing performance metrics. Page 3 lists six acceptable quality levels including 99.5% data freshness for daily ingestion pipelines.' },
        { name: 'Wage_Determination_Annex.pdf', size: '0.6 MB', posted: '2026-04-12', snapshot: 'SCA wage determination 2015-4181 Rev 28 (effective 2026-01-01). Computer programmer GS-12 equivalent rates apply.' },
        { name: 'Past_Performance_Questionnaire.docx', size: '0.05 MB', posted: '2026-04-12', snapshot: 'Three references required. Each must include contract value, period of performance, and CO point of contact for contract action history.' },
      ].map((d) => (
        <li key={d.name} className="rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <div className="flex items-start gap-3">
            <FileText className="mt-1 h-5 w-5 text-muted-soft" />
            <div className="flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">{d.name}</span>
                <span className="text-[11px] text-muted-soft">{d.size} · {fmtDate(d.posted)}</span>
              </div>
              <TextSnapshot text={d.snapshot} />
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Incumbents tab ───────────────────────────────────────────────────────
function IncumbentsTab() {
  return (
    <table className="w-full text-sm">
      <thead className="bg-brand-teal-deep/85">
        <tr>
          <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Award</th>
          <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Awardee</th>
          <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Agency</th>
          <th className="px-3 py-2 text-right text-[11px] uppercase text-muted-soft">Similarity</th>
        </tr>
      </thead>
      <tbody>
        {[
          { award: 'HHSP233201600022I', awardee: 'Booz Allen Hamilton', agency: 'CDC',          sim: 0.91 },
          { award: 'HHSP233201500031I', awardee: 'Deloitte Consulting',  agency: 'CDC',          sim: 0.88 },
          { award: 'HHSP233201400007I', awardee: 'CGI Federal',          agency: 'CDC',          sim: 0.83 },
          { award: 'HHSP233201700045I', awardee: 'Leidos',               agency: 'CDC',          sim: 0.81 },
        ].map((r) => (
          <tr key={r.award} className="border-b border-border/40 hover:bg-brand-teal-soft/15">
            <td className="px-3 py-2">{r.award}</td>
            <td className="px-3 py-2">{r.awardee}</td>
            <td className="px-3 py-2 text-muted">{r.agency}</td>
            <td className="px-3 py-2 text-right">
              <span className="inline-flex items-center gap-1.5">
                <AIBadge label="AI" />
                <span className="font-semibold tabular-nums">{(r.sim * 100).toFixed(0)}%</span>
              </span>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Bidders tab ──────────────────────────────────────────────────────────
function BiddersTab() {
  return (
    <table className="w-full text-sm">
      <thead className="bg-brand-teal-deep/85">
        <tr>
          <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Awardee</th>
          <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">HQ</th>
          <th className="px-3 py-2 text-right text-[11px] uppercase text-muted-soft">2025 obligations</th>
          <th className="px-3 py-2 text-right text-[11px] uppercase text-muted-soft">Match</th>
        </tr>
      </thead>
      <tbody>
        {[
          { name: 'Booz Allen Hamilton',  hq: 'McLean, VA',     obs: 14_300_000_000, match: 0.94 },
          { name: 'Deloitte Consulting',  hq: 'New York, NY',   obs: 9_700_000_000,  match: 0.91 },
          { name: 'CGI Federal',          hq: 'Fairfax, VA',    obs: 5_400_000_000,  match: 0.86 },
          { name: 'Leidos',               hq: 'Reston, VA',     obs: 12_100_000_000, match: 0.84 },
          { name: 'SAIC',                 hq: 'Reston, VA',     obs: 7_800_000_000,  match: 0.81 },
        ].map((r) => (
          <tr key={r.name} className="border-b border-border/40 hover:bg-brand-teal-soft/15">
            <td className="px-3 py-2 font-medium">{r.name}</td>
            <td className="px-3 py-2 text-muted">{r.hq}</td>
            <td className="px-3 py-2 text-right tabular-nums">{fmtMoney(r.obs)}</td>
            <td className="px-3 py-2 text-right">
              <AIBadge label={`${(r.match * 100).toFixed(0)}%`} />
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

// ─── Similar tab ──────────────────────────────────────────────────────────
function SimilarTab() {
  return (
    <ul className="flex flex-col gap-2">
      {[
        { title: 'NIH BRAIN Initiative — Data Coordinating Center', agency: 'NIH', deadline: '2026-06-22', similarity: 0.86 },
        { title: 'CMS Quality Reporting Modernization',             agency: 'CMS', deadline: '2026-07-15', similarity: 0.83 },
        { title: 'HRSA EHB Data Pipeline Refresh',                  agency: 'HRSA', deadline: '2026-08-04', similarity: 0.79 },
      ].map((s) => (
        <li key={s.title} className="flex items-center justify-between rounded-lg border border-border bg-brand-teal-deep/25 px-3 py-2">
          <div>
            <div className="text-sm font-medium">{s.title}</div>
            <div className="text-[11px] text-muted-soft">{s.agency} · Due {fmtDate(s.deadline)}</div>
          </div>
          <AIBadge label={`${(s.similarity * 100).toFixed(0)}%`} />
        </li>
      ))}
    </ul>
  );
}

// ─── Experts tab ──────────────────────────────────────────────────────────
function ExpertsTab() {
  return (
    <ul className="flex flex-col gap-2">
      {[
        { name: 'Dr. Patricia Owens', specialty: 'Public health surveillance, CDC',           rating: 'Strong Match' },
        { name: 'Anil Kapoor',         specialty: 'Cloud data engineering, AWS-certified',     rating: 'Strong Match' },
        { name: 'Sarah Chen',          specialty: 'HIPAA + FedRAMP compliance',                rating: 'Medium Match' },
      ].map((e) => (
        <li key={e.name} className="rounded-lg border border-border bg-brand-teal-deep/25 px-3 py-2">
          <div className="flex items-center justify-between">
            <div>
              <div className="text-sm font-semibold">{e.name}</div>
              <div className="text-[11px] text-muted-soft">{e.specialty}</div>
            </div>
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ${e.rating === 'Strong Match' ? 'bg-brand-sage/15 text-brand-sage' : 'bg-brand-vermilion/15 text-brand-vermilion-soft'}`}>
              {e.rating}
            </span>
          </div>
        </li>
      ))}
    </ul>
  );
}

// ─── Mock fixture (Phase 0 demo) ──────────────────────────────────────────
const MOCK_OPP = {
  opportunity_id: 'opp-1',
  slug: 'cdc-data-platform-modernization-fy26',
  solicitation_number: 'NCHHSTP-26-0142',
  title: 'CDC Data Platform Modernization — FY26 Phase II',
  type: 'Solicitation',
  agency: 'Centers for Disease Control and Prevention',
  set_aside: '8(a)',
  naics: '541512',
  psc: 'DA01',
  posted_at: '2026-04-12T10:00:00Z',
  response_deadline: '2026-06-15T17:00:00Z',
  is_active: true,
  ai_value_min: 12_000_000,
  ai_value_max: 24_000_000,
  source_url: 'https://sam.gov/opp/0142',
  description: `The Centers for Disease Control and Prevention (CDC), National Center for HIV/AIDS, Viral Hepatitis, STD, and TB Prevention (NCHHSTP) seeks a contractor to provide comprehensive cloud-native data engineering services for the modernization of its surveillance data platform. The Period of Performance is one base year with four option years. The selected contractor shall design, implement, and operate scalable data pipelines feeding the agency's surveillance dashboards, with emphasis on Snowflake or Databricks expertise and HIPAA-aligned data handling. All services shall comply with FedRAMP Moderate posture requirements outlined in Section 4.2 of the PWS.\n\nKey tasks include: (a) developing automated ETL pipelines from agency data sources, (b) building modular dashboards for public health stakeholders, (c) ensuring data security and compliance across environments, (d) supporting agile delivery cadences, and (e) providing knowledge transfer at contract closeout. The contractor shall maintain documented runbooks, automated test coverage exceeding 80%, and ensure zero-downtime deployment for production releases.`,
  description_summary: 'CDC NCHHSTP seeks a cloud-native data engineering contractor for a multi-year IDIQ supporting public health surveillance dashboards. Emphasis on Snowflake/Databricks, HIPAA-aligned handling, and FedRAMP Moderate posture. One base year + four option years.',
};
