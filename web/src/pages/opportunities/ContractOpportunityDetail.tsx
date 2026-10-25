import * as React from 'react';
import { useParams } from 'react-router-dom';
import { Share2, ThumbsDown, Star, Bell, ExternalLink, Sparkles, MapPin, FileText } from 'lucide-react';
import { EntityDetailLayout, type TabDef } from '@/components/ui/EntityDetailLayout';
import { TextSnapshot } from '@/components/ui/TextSnapshot';
import { EmptyState } from '@/components/ui/EmptyState';
import { AIAssistantChat } from '@/components/ui/AIAssistantChat';
import { fmtDate } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { api, ApiError } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Federal Contract Opportunity — detail page.
 *
 * Wired to GET /pipeline/solicitations/:id (workers/api) — the same CDC
 * solicitation pipeline the list view uses. The tabs that have real data
 * today are shown (Description = AI SOW summary, Overview = metadata,
 * Docs = attachments). The investor-demo tabs that ran on fabricated data
 * (incumbents, bidders, experts, similar, contacts) are intentionally not
 * shown here — they return once those domains are ingested rather than
 * presenting invented names as if they were real.
 */

const PRIMARY_TABS: TabDef[] = [
  { id: 'description', label: 'Description' },
  { id: 'overview',    label: 'Overview' },
  { id: 'docs',        label: 'Docs' },
  { id: 'assistant',   label: 'Assistant' },
];

interface SolicitationDetail {
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
  psc_codes: string | null;
  set_aside: string | null;
  pop_state: string | null;
  pop_city: string | null;
  description: string | null;
  link: string | null;
}

interface Attachment {
  attachment_id: string;
  file_name: string | null;
  file_url: string | null;
  file_type: string | null;
  size_bytes: number | null;
  extracted_chars: number | null;
  extract_error: string | null;
  sow_summary: string | null;
  summarized_at: number | null;
}

interface DetailResponse {
  solicitation: SolicitationDetail;
  attachments: Attachment[];
}

export function ContractOpportunityDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const [activeTab, setActiveTab] = React.useState('overview');
  const [data, setData] = React.useState<DetailResponse | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState<string | null>(null);

  React.useEffect(() => {
    if (!slug) return;
    let alive = true;
    setLoading(true);
    api
      .get<DetailResponse>(`/pipeline/solicitations/${encodeURIComponent(slug)}`)
      .then((d) => { if (alive) { setData(d); setError(null); } })
      .catch((e) => {
        if (alive) setError(
          e instanceof ApiError
            ? (e.status === 404 ? 'This solicitation is no longer in the pipeline.' : `Couldn't load it (API ${e.status}).`)
            : "Couldn't load this opportunity.",
        );
      })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [slug]);

  if (loading) {
    return <div className="p-8 text-sm text-muted">Loading opportunity…</div>;
  }
  if (error || !data || !data.solicitation) {
    return (
      <div className="p-8">
        <EmptyState icon={FileText} title="Couldn't load this opportunity." message={error ?? 'Unknown error.'} />
      </div>
    );
  }

  const s = data.solicitation;
  const docs = data.attachments ?? [];
  // Primary document = the longest summarized attachment (usually the SOW/PWS,
  // vs. cover letters or amendments).
  const primary =
    [...docs].filter((d) => d.sow_summary).sort((a, b) => (b.extracted_chars ?? 0) - (a.extracted_chars ?? 0))[0] ?? null;
  const agency = s.office ?? s.sub_agency ?? s.agency ?? '—';
  const naics = (s.naics_codes ?? '').split('|')[0] || null;
  const isActive = !!s.response_deadline && new Date(s.response_deadline) >= new Date();

  return (
    <>
      <EntityDetailLayout
        back={{ label: 'Contract Opportunities', to: routes.contractOpps }}
        title={s.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-x-3 gap-y-0.5">
            <span>{s.sol_number ?? '(no sol #)'}</span>
            <span>·</span>
            <span>{agency}</span>
            {naics && (<><span>·</span><span>NAICS {naics}</span></>)}
          </span>
        }
        pill={
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider ring-1 ${isActive ? 'bg-emerald-500/15 text-emerald-400 ring-emerald-500/30' : 'bg-muted/15 text-muted ring-border'}`}>
            {isActive ? 'Active' : 'Closed'}
          </span>
        }
        actions={
          <>
            <IconButton icon={Share2}     label="Share" />
            <IconButton icon={ThumbsDown} label="No bid" />
            <IconButton icon={Star}       label="Favorite" />
            <IconButton icon={Bell}       label="Notify" />
          </>
        }
        primaryTabs={PRIMARY_TABS}
        secondaryTabs={[]}
        activeTab={activeTab}
        onTabChange={setActiveTab}
      >
        {activeTab === 'description' && (
          primary?.sow_summary ? (
            <div className="max-w-[72ch]">
              <div className="mb-2 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
                <Sparkles className="h-3 w-3" /> AI summary · {primary.file_name ?? 'SOW'}
              </div>
              <div className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">{primary.sow_summary}</div>
            </div>
          ) : (
            <EmptyState
              icon={Sparkles}
              title="No AI summary yet."
              message="This solicitation's attachments haven't been summarized. Summaries generate automatically after the extraction pipeline runs."
            />
          )
        )}
        {activeTab === 'overview' && <OverviewTab s={s} agency={agency} naics={naics} isActive={isActive} />}
        {activeTab === 'docs' && <DocsTab docs={docs} />}
        {activeTab === 'assistant' && (
          <EmptyState
            icon={Sparkles}
            title="Use the floating ✦ assistant button."
            message="The Opportunity Assistant answers questions over this solicitation's attachment text. Open it via the bottom-right launcher."
          />
        )}
      </EntityDetailLayout>

      <AIAssistantChat
        title="Opportunity Assistant"
        context={{ kind: 'opportunity', id: s.solicitation_id, title: s.title }}
        suggestedPrompts={[
          'Summarize the scope and key deliverables.',
          'What are the submission requirements and the deadline?',
          'What qualifications or set-aside apply?',
        ]}
        onSendMessage={async (text) => {
          await new Promise((r) => setTimeout(r, 400));
          return { content: `_(demo response)_ "${text}" — the AI chat endpoint lands in a later phase; it will answer from this solicitation's extracted attachment text.` };
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
      onClick={() => toast.info(`${label} — coming soon`)}
    >
      <Icon className="h-3.5 w-3.5" />
      <span className="hidden md:inline">{label}</span>
    </button>
  );
}

// ─── Overview tab (real metadata) ─────────────────────────────────────────
function OverviewTab({ s, agency, naics, isActive }: { s: SolicitationDetail; agency: string; naics: string | null; isActive: boolean }) {
  const pop = [s.pop_city, s.pop_state].filter(Boolean).join(', ') || null;
  const psc = (s.psc_codes ?? '').split('|')[0] || null;
  return (
    <div className="grid gap-x-6 gap-y-4 md:grid-cols-2">
      <KV label="Agency"              value={agency} />
      <KV label="Notice type"         value={s.notice_type} />
      <KV label="Response deadline"   value={s.response_deadline ? fmtDate(s.response_deadline) : 'Not specified'} />
      <KV label="Posted"              value={s.posted_date ? fmtDate(s.posted_date) : '—'} />
      <KV label="Set aside"           value={s.set_aside ?? 'None'} />
      <KV label="NAICS"               value={naics ?? '—'} />
      <KV label="PSC"                 value={psc ?? '—'} />
      <KV
        label="Place of performance"
        value={pop ? <span className="inline-flex items-center gap-1.5"><MapPin className="h-3.5 w-3.5 text-muted-soft" />{pop}</span> : '—'}
      />
      <KV label="Status" value={isActive ? 'Open' : 'Closed'} />
      <KV
        label="Source"
        value={s.link
          ? <a href={s.link} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-brand-vermilion-soft hover:underline">SAM.gov <ExternalLink className="h-3 w-3" /></a>
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

// ─── Docs tab (real attachments) ──────────────────────────────────────────
function DocsTab({ docs }: { docs: Attachment[] }) {
  if (docs.length === 0) {
    return <EmptyState icon={FileText} title="No attachments." message="This solicitation has no documents on record." />;
  }
  return (
    <ul className="flex flex-col gap-3">
      {docs.map((d) => (
        <li key={d.attachment_id} className="rounded-xl border border-border bg-brand-teal-deep/25 p-3">
          <div className="flex items-start gap-3">
            <FileText className="mt-1 h-5 w-5 shrink-0 text-muted-soft" />
            <div className="min-w-0 flex-1">
              <div className="flex items-center justify-between gap-3">
                <span className="truncate text-sm font-semibold">{d.file_name ?? d.attachment_id}</span>
                {d.file_url && (
                  <a href={d.file_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-vermilion-soft hover:underline">
                    Download <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>
              {d.sow_summary
                ? <TextSnapshot text={d.sow_summary} />
                : <div className="mt-1 text-[11px] text-muted-soft">{d.extract_error ? 'Not a readable PDF — no summary.' : 'Awaiting summary.'}</div>}
            </div>
          </div>
        </li>
      ))}
    </ul>
  );
}
