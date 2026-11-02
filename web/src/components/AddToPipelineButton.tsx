import * as React from 'react';
import { ListPlus, Plus, Loader2 } from 'lucide-react';
import { api } from '@/lib/api';
import { toast } from 'sonner';

/**
 * Add the current entity to one of the signed-in user's capture pipelines as a
 * pursuit (it lands in the "Identified" stage on the board). The menu lazily
 * loads the user's pipelines from GET /me/pipelines on first open and can also
 * create a new pipeline inline. Reuses the existing user-scoped /me/pipelines +
 * /me/pursuits endpoints — no new backend. Sits beside FavoriteStar in a detail
 * page's actions.
 */

interface Pipeline {
  id: string;
  name: string;
  pursuit_count?: number;
}

export function AddToPipelineButton({
  entity_type,
  entity_id,
  title,
}: {
  entity_type: string;
  entity_id: string;
  title: string;
}) {
  const [open, setOpen] = React.useState(false);
  const [pipelines, setPipelines] = React.useState<Pipeline[] | null>(null);
  const [loading, setLoading] = React.useState(false);
  const [busyId, setBusyId] = React.useState<string | null>(null);
  const wrapRef = React.useRef<HTMLDivElement>(null);

  // Load the user's pipelines the first time the menu opens, then cache them.
  const load = React.useCallback(() => {
    setLoading(true);
    api
      .get<{ results: Pipeline[] }>('/me/pipelines')
      .then((d) => setPipelines(d.results ?? []))
      .catch(() => { setPipelines([]); toast.error('Could not load your pipelines'); })
      .finally(() => setLoading(false));
  }, []);

  const onToggle = () => {
    const next = !open;
    setOpen(next);
    if (next && pipelines === null) load();
  };

  // Close on an outside click or Escape.
  React.useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  const addToPipeline = async (p: Pipeline) => {
    setBusyId(p.id);
    try {
      await api.post('/me/pursuits', { pipeline_id: p.id, title, entity_type, entity_id });
      toast.success(`Added to "${p.name}"`);
      setOpen(false);
      // Reflect the new count locally so the menu is accurate if reopened.
      setPipelines((prev) =>
        prev?.map((x) => (x.id === p.id ? { ...x, pursuit_count: (x.pursuit_count ?? 0) + 1 } : x)) ?? prev,
      );
    } catch {
      toast.error('Could not add to pipeline');
    } finally {
      setBusyId(null);
    }
  };

  const createAndAdd = async () => {
    const name = window.prompt('Name the new pipeline:')?.trim();
    if (!name) return;
    setBusyId('__new__');
    try {
      const p = await api.post<Pipeline>('/me/pipelines', { name });
      await api.post('/me/pursuits', { pipeline_id: p.id, title, entity_type, entity_id });
      toast.success(`Created "${name}" and added this`);
      setOpen(false);
      setPipelines((prev) => [{ ...p, pursuit_count: 1 }, ...(prev ?? [])]);
    } catch {
      toast.error('Could not create pipeline');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div ref={wrapRef} className="relative inline-block">
      <button
        type="button"
        onClick={onToggle}
        aria-haspopup="menu"
        aria-expanded={open}
        title="Add to a capture pipeline"
        className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30"
      >
        <ListPlus className="h-3.5 w-3.5" />
        <span className="hidden md:inline">Add to pipeline</span>
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-1 w-64 overflow-hidden rounded-lg border border-border bg-brand-teal-deep/95 shadow-xl backdrop-blur"
        >
          <div className="border-b border-border px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-muted-soft">
            Add to pipeline
          </div>

          {loading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[13px] text-muted">
              <Loader2 className="h-3.5 w-3.5 animate-spin" /> Loading…
            </div>
          ) : (
            <div className="max-h-64 overflow-y-auto py-1">
              {(pipelines ?? []).map((p) => (
                <button
                  key={p.id}
                  type="button"
                  role="menuitem"
                  disabled={busyId != null}
                  onClick={() => addToPipeline(p)}
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-[13px] text-foreground transition-colors hover:bg-brand-teal-soft/30 disabled:opacity-50"
                >
                  <span className="truncate">{p.name}</span>
                  {busyId === p.id ? (
                    <Loader2 className="h-3.5 w-3.5 shrink-0 animate-spin" />
                  ) : (
                    <span className="shrink-0 text-[11px] text-muted-soft">{p.pursuit_count ?? 0}</span>
                  )}
                </button>
              ))}

              {pipelines != null && pipelines.length === 0 && (
                <div className="px-3 py-2 text-[12px] text-muted-soft">No pipelines yet — create one below.</div>
              )}

              <button
                type="button"
                role="menuitem"
                disabled={busyId != null}
                onClick={createAndAdd}
                className="mt-1 flex w-full items-center gap-2 border-t border-border px-3 py-2 text-left text-[13px] font-medium text-brand-vermilion-soft transition-colors hover:bg-brand-teal-soft/30 disabled:opacity-50"
              >
                {busyId === '__new__' ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
                New pipeline…
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
