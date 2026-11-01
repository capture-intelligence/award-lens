import * as React from 'react';
import { BookmarkPlus } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Save the current list-page search as a named saved search (user-scoped).
 * Minimal v1: prompts for a name, POSTs { entity, query } to /saved-searches.
 * Re-run from the Saved Searches page.
 */
export function SaveSearchButton({ entity, query }: { entity: string; query: Record<string, unknown> }) {
  const [saving, setSaving] = React.useState(false);
  const onSave = async () => {
    const name = window.prompt('Name this saved search:')?.trim();
    if (!name) return;
    setSaving(true);
    try {
      await api.post('/saved-searches', { name, entity, query_json: query });
      toast.success('Search saved');
    } catch {
      toast.error('Could not save search');
    } finally {
      setSaving(false);
    }
  };
  return (
    <button
      type="button"
      onClick={onSave}
      disabled={saving}
      className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30 disabled:opacity-50"
    >
      <BookmarkPlus className="h-3.5 w-3.5" /> Save search
    </button>
  );
}
