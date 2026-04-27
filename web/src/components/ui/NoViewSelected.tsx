import { Database, ArrowUp } from 'lucide-react';
import { Card } from '@/components/ui/Card';
import { useViews } from '@/lib/view-context';
import { navigate } from '@/lib/router';

/**
 * Shown on Awards, Vendors, Exclusions, Opportunities when the
 * user hasn't picked a view from the topbar. These pages are view-scoped
 * by design — there's no global mode.
 */
export function NoViewSelected({ pageLabel }: { pageLabel: string }) {
  const { available } = useViews();
  const hasViews = available.length > 0;

  return (
    <Card>
      <div className="flex flex-col items-center px-6 py-16 text-center">
        <div className="grid h-14 w-14 place-items-center rounded-2xl bg-brand-sage/15 text-brand-sage ring-1 ring-brand-sage/40">
          <Database className="h-6 w-6" />
        </div>

        <h3 className="mt-6 text-xl font-bold tracking-tight text-foreground">
          Select a view to see {pageLabel}
        </h3>
        <p className="mt-3 max-w-md text-sm text-muted">
          {hasViews
            ? 'Pick a view from the dropdown at the top of the page — every result will be scoped to that view.'
            : "You haven't been granted access to any view yet. Browse the catalog and request access; an admin will review."}
        </p>

        {hasViews ? (
          <div className="mt-8 inline-flex items-center gap-2 rounded-full border border-brand-sage/30 bg-brand-sage/10 px-4 py-2 text-xs font-semibold uppercase tracking-[0.12em] text-brand-sage">
            <ArrowUp className="h-3.5 w-3.5" />
            View selector — top of the page
          </div>
        ) : (
          <button
            type="button"
            onClick={() => navigate('/views')}
            className="mt-8 inline-flex items-center gap-2 rounded-lg border border-brand-vermilion/30 bg-brand-vermilion/15 px-4 py-2 text-sm font-semibold text-brand-vermilion-soft transition-colors hover:bg-brand-vermilion/25"
          >
            Browse views →
          </button>
        )}
      </div>
    </Card>
  );
}
