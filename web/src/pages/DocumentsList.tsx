import * as React from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { SaveSearchButton } from '@/components/SaveSearchButton';
import { FileText, ExternalLink, Sparkles } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { EmptyState } from '@/components/ui/EmptyState';
import { api } from '@/lib/api';

/**
 * Documents — solicitation attachments (PDFs) with their AI SOW summaries.
 *
 * Wired to GET /documents (workers/api → solicitation_attachment joined to the
 * solicitation). Summarized docs first; keyword search hits the API. Each card
 * links to its solicitation and offers the source download. Null-safe.
 */

interface DocRow {
  attachment_id: string;
  file_name: string | null;
  file_type: string | null;
  size_bytes: number | null;
  file_url: string | null;
  sow_summary: string | null;
  summarized_at: number | null;
  extract_error: string | null;
  solicitation_id: string | null;
  solicitation_title: string | null;
  sol_number: string | null;
}

function fmtBytes(b: number | null): string {
  if (b == null) return '';
  if (b >= 1e6) return `${(b / 1e6).toFixed(1)} MB`;
  if (b >= 1e3) return `${Math.round(b / 1e3)} KB`;
  return `${b} B`;
}

export function DocumentsListPage() {
  const [searchParams] = useSearchParams();
  const [filters, setFilters] = React.useState<FilterState>(() => {
    const initQ = searchParams.get('q') ?? '';
    const search: FilterState['search'] = initQ ? { q: { kind: 'text', value: initQ } } : {};
    return { quick: {}, search };
  });
  const [rows, setRows] = React.useState<DocRow[]>([]);
  const [loading, setLoading] = React.useState(true);

  const q = (filters.search?.q as { kind: 'text'; value: string } | undefined)?.value ?? '';
  const [debouncedQ, setDebouncedQ] = React.useState('');
  React.useEffect(() => {
    const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
    return () => clearTimeout(t);
  }, [q]);

  React.useEffect(() => {
    let alive = true;
    setLoading(true);
    api
      .get<{ count: number; results: DocRow[] }>('/documents', { limit: '200', ...(debouncedQ ? { q: debouncedQ } : {}) })
      .then((d) => { if (alive) setRows(d.results ?? []); })
      .catch(() => { if (alive) setRows([]); })
      .finally(() => { if (alive) setLoading(false); });
    return () => { alive = false; };
  }, [debouncedQ]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Documents"
        description="Solicitation attachments from the CDC contract pipeline, with AI-generated statement-of-work summaries where available."
        actions={<SaveSearchButton entity="documents" query={{ q: debouncedQ }} />}
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          {loading ? 'Loading…' : `${rows.length.toLocaleString()} documents`}
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[]}
          searchFilters={[{ id: 'q', label: 'Search documents', type: 'text' }]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <div className="flex flex-col gap-3">
          {loading ? (
            <div className="px-1 py-6 text-sm text-muted">Loading…</div>
          ) : rows.length === 0 ? (
            <EmptyState icon={FileText} title="No documents." message="No solicitation attachments match your search." />
          ) : (
            rows.map((d) => (
              <div key={d.attachment_id} className="rounded-xl border border-border bg-brand-teal-deep/25 p-4">
                <div className="flex items-start gap-3">
                  <FileText className="mt-0.5 h-5 w-5 shrink-0 text-muted-soft" />
                  <div className="min-w-0 flex-1">
                    <div className="flex items-start justify-between gap-3">
                      <span className="truncate text-sm font-semibold text-foreground">{d.file_name ?? d.attachment_id}</span>
                      {d.file_url && (
                        <a href={d.file_url} target="_blank" rel="noreferrer" className="inline-flex shrink-0 items-center gap-1 text-[11px] text-brand-vermilion-soft hover:underline">
                          Download <ExternalLink className="h-3 w-3" />
                        </a>
                      )}
                    </div>
                    <div className="mt-0.5 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[11px] text-muted-soft">
                      {d.solicitation_id
                        ? <Link to={`/opportunity/contract/${d.solicitation_id}`} className="truncate hover:text-brand-vermilion-soft hover:underline">{d.solicitation_title ?? d.sol_number ?? 'solicitation'}</Link>
                        : <span className="truncate">{d.solicitation_title ?? '—'}</span>}
                      {d.file_type && (<><span>·</span><span className="uppercase">{d.file_type}</span></>)}
                      {d.size_bytes != null && (<><span>·</span><span>{fmtBytes(d.size_bytes)}</span></>)}
                    </div>
                    {d.sow_summary ? (
                      <div className="mt-2">
                        <span className="mb-1 inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider text-brand-vermilion-soft"><Sparkles className="h-3 w-3" /> AI summary</span>
                        <p className="line-clamp-3 text-[12px] leading-relaxed text-muted">{d.sow_summary}</p>
                      </div>
                    ) : (
                      <p className="mt-1.5 text-[11px] text-muted-soft">{d.extract_error ? 'Not a readable PDF — no summary.' : 'Awaiting AI summary.'}</p>
                    )}
                  </div>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
