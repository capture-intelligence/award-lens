import * as React from 'react';
import { Link } from 'react-router-dom';
import { Bookmark, X, ArrowRight } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { fmtDate } from '@/lib/utils';
import { useFavorites } from '@/lib/favorites-context';

/**
 * Favorites — the user's bookmarked entities, grouped by type, each linking to
 * its detail page. Uses the FavoritesProvider cache (no extra fetch). The list
 * stores only (entity_type, entity_id); names are shown on the detail page the
 * link opens — enriching with titles here is a follow-up.
 */

const ENTITY_META: Record<string, { label: string; to: (id: string) => string }> = {
  award:        { label: 'Contract Awards',        to: (id) => `/award/contract/prime/${id}` },
  grant:        { label: 'Grant Opportunities',    to: (id) => `/opportunity/grant/${id}` },
  solicitation: { label: 'Contract Opportunities', to: (id) => `/opportunity/contract/${id}` },
  agency:       { label: 'Agencies',               to: (id) => `/agency/${id}` },
  awardee:      { label: 'Awardees',               to: (id) => `/awardee/${id}` },
};

export function FavoritesPage() {
  const { list, loading, toggle } = useFavorites();

  const groups = React.useMemo(() => {
    const m = new Map<string, typeof list>();
    for (const f of list) {
      const arr = m.get(f.entity_type) ?? [];
      arr.push(f);
      m.set(f.entity_type, arr);
    }
    return [...m.entries()];
  }, [list]);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Workspace"
        title="Favorites"
        description="Entities you've starred. Open the star on any award, opportunity, awardee, or agency to add it here."
      />
      {loading ? (
        <div className="px-1 py-6 text-sm text-muted">Loading…</div>
      ) : list.length === 0 ? (
        <EmptyState icon={Bookmark} title="No favorites yet." message="Star an award, opportunity, awardee, or agency from its detail page." />
      ) : (
        <div className="flex flex-col gap-6">
          {groups.map(([type, items]) => {
            const meta = ENTITY_META[type];
            return (
              <div key={type}>
                <div className="mb-2 text-[11px] font-bold uppercase tracking-[0.12em] text-muted-soft">
                  {meta?.label ?? type} <span className="text-muted">· {items.length}</span>
                </div>
                <ul className="flex flex-col gap-2">
                  {items.map((f) => (
                    <li key={`${f.entity_type}:${f.entity_id}`} className="flex items-center justify-between gap-4 rounded-xl border border-border bg-brand-teal-deep/25 p-3">
                      <div className="min-w-0">
                        <div className="truncate text-sm font-medium tabular-nums text-foreground">{f.entity_id}</div>
                        <div className="text-[11px] text-muted-soft">saved {fmtDate(f.created_at)}</div>
                      </div>
                      <div className="flex shrink-0 items-center gap-2">
                        {meta && (
                          <Link to={meta.to(f.entity_id)} className="inline-flex items-center gap-1 rounded-md border border-border bg-brand-teal-deep/40 px-2.5 py-1.5 text-[12px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30">
                            Open <ArrowRight className="h-3 w-3" />
                          </Link>
                        )}
                        <button type="button" onClick={() => toggle(f.entity_type, f.entity_id)} aria-label="Remove favorite" className="inline-flex items-center rounded-md border border-border bg-brand-teal-deep/40 p-1.5 text-muted-soft transition-colors hover:bg-brand-vermilion/15 hover:text-brand-vermilion-soft">
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </li>
                  ))}
                </ul>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
