import * as React from 'react';
import { useNavigate } from 'react-router-dom';
import { Bell, Trash2, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDate } from '@/lib/utils';
import { routes } from '@/lib/routes';
import { api } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Saved Searches — per-user named filter sets. Wired to the user-scoped
 * /saved-searches CRUD. "Apply" re-opens the entity's list with the saved
 * keyword; "Delete" removes it. A search is created from a list page via the
 * SaveSearchButton.
 */

interface SavedSearch {
  id: string;
  name: string;
  entity: string;
  query_json: string | null;
  created_at: string;
}

// entity key → where "Apply" navigates + a friendly label.
const ENTITY_ROUTE: Record<string, { to: string; label: string }> = {
  grants:    { to: routes.grantOpps,     label: 'Grant Opportunities' },
  contracts: { to: routes.contractOpps,  label: 'Contract Opportunities' },
  awardees:  { to: routes.awardees,      label: 'Awardees' },
  agencies:  { to: routes.agencies,      label: 'Agencies' },
  awards:    { to: routes.contractAwards, label: 'Contract Awards' },
  documents: { to: routes.documents,     label: 'Documents' },
};

export function SavedSearchesPage() {
  const [rows, setRows] = React.useState<SavedSearch[] | null>(null);
  const navigate = useNavigate();

  const load = React.useCallback(() => {
    api.get<{ results: SavedSearch[] }>('/saved-searches')
      .then((d) => setRows(d.results ?? []))
      .catch(() => setRows([]));
  }, []);
  React.useEffect(() => { load(); }, [load]);

  const apply = (s: SavedSearch) => {
    const ent = ENTITY_ROUTE[s.entity];
    if (!ent) { toast.info('This saved search has no matching page.'); return; }
    let q = '';
    try { q = s.query_json ? (JSON.parse(s.query_json).q ?? '') : ''; } catch { /* ignore */ }
    navigate(q ? `${ent.to}?q=${encodeURIComponent(q)}` : ent.to);
  };

  const remove = async (id: string) => {
    try { await api.del(`/saved-searches/${id}`); toast.success('Deleted'); load(); }
    catch { toast.error('Could not delete'); }
  };

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Workspace"
        title="Saved Searches"
        description="Your saved filter sets. Save one from the search box on any list page, then re-run it here."
      />
      {rows == null ? (
        <div className="px-1 py-6 text-sm text-muted">Loading…</div>
      ) : rows.length === 0 ? (
        <EmptyState icon={Bell} title="No saved searches yet." message="On a list page (e.g. Grant Opportunities), type a search and click 'Save search'." />
      ) : (
        <ul className="flex flex-col gap-2">
          {rows.map((s) => {
            const ent = ENTITY_ROUTE[s.entity];
            let q = '';
            try { q = s.query_json ? (JSON.parse(s.query_json).q ?? '') : ''; } catch { /* ignore */ }
            return (
              <li key={s.id} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-brand-teal-deep/25 p-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-foreground">{s.name}</div>
                  <div className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-soft">
                    <span className="rounded-full bg-brand-teal-soft/20 px-1.5 py-px uppercase tracking-wide">{ent?.label ?? s.entity}</span>
                    {q && <span>· “{q}”</span>}
                    <span>· saved {fmtDate(s.created_at)}</span>
                  </div>
                </div>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => apply(s)} className="inline-flex items-center gap-1 rounded-md border border-border bg-brand-teal-deep/40 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30">
                    Apply <ArrowRight className="h-3 w-3" />
                  </button>
                  <button type="button" onClick={() => remove(s.id)} aria-label="Delete" className="inline-flex items-center rounded-md border border-border bg-brand-teal-deep/40 p-1.5 text-muted-soft transition-colors hover:bg-brand-vermilion/15 hover:text-brand-vermilion-soft">
                    <Trash2 className="h-3.5 w-3.5" />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
