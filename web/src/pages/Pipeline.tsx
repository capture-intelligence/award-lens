import * as React from 'react';
import { Briefcase, Plus, Trash2, ChevronLeft, ChevronRight, Layers, X } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { EmptyState } from '@/components/ui/EmptyState';
import { api, ApiError } from '@/lib/api';
import { fmtDate } from '@/lib/utils';
import { toast } from 'sonner';

/**
 * Pipelines — the per-user BD capture board. A pipeline is a named board; a
 * pursuit is a card that moves across capture stages. Wired to the user-scoped
 * /me/pipelines + /me/pursuits CRUD (every query filtered by user_id server-
 * side). Stage moves use chevron buttons rather than drag-and-drop — simpler
 * and keyboard-friendly — and apply optimistically with a revert on failure.
 */

interface Pipeline {
  id: string;
  name: string;
  created_at: string;
  pursuit_count: number;
}

interface Pursuit {
  id: string;
  pipeline_id: string;
  entity_type: string | null;
  entity_id: string | null;
  title: string;
  stage: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

// The capture ladder, in order. Keys must match the worker's PURSUIT_STAGES.
const STAGES: Array<{ key: string; label: string }> = [
  { key: 'identified', label: 'Identified' },
  { key: 'qualifying', label: 'Qualifying' },
  { key: 'capturing',  label: 'Capturing' },
  { key: 'proposal',   label: 'Proposal' },
  { key: 'submitted',  label: 'Submitted' },
  { key: 'won',        label: 'Won' },
  { key: 'lost',       label: 'Lost' },
];
const STAGE_KEYS = STAGES.map((s) => s.key);

export function PipelinePage() {
  const [pipelines, setPipelines] = React.useState<Pipeline[] | null>(null);
  const [selectedId, setSelectedId] = React.useState<string | null>(null);
  const [pursuits, setPursuits] = React.useState<Pursuit[] | null>(null);
  const [newName, setNewName] = React.useState('');
  const [creating, setCreating] = React.useState(false);

  // Load the user's boards once; preselect the first.
  React.useEffect(() => {
    let alive = true;
    api.get<{ results: Pipeline[] }>('/me/pipelines')
      .then((d) => {
        if (!alive) return;
        const list = d.results ?? [];
        setPipelines(list);
        setSelectedId((cur) => cur ?? list[0]?.id ?? null);
      })
      .catch(() => { if (alive) setPipelines([]); });
    return () => { alive = false; };
  }, []);

  // Load the selected board's cards whenever the selection changes.
  React.useEffect(() => {
    if (!selectedId) { setPursuits(null); return; }
    let alive = true;
    setPursuits(null);
    api.get<{ results: Pursuit[] }>('/me/pursuits', { pipeline_id: selectedId })
      .then((d) => { if (alive) setPursuits(d.results ?? []); })
      .catch(() => { if (alive) setPursuits([]); });
    return () => { alive = false; };
  }, [selectedId]);

  const createPipeline = async () => {
    const name = newName.trim();
    if (!name) return;
    setCreating(true);
    try {
      const p = await api.post<Pipeline>('/me/pipelines', { name });
      setPipelines((cur) => [{ ...p, pursuit_count: 0 }, ...(cur ?? [])]);
      setSelectedId(p.id);
      setNewName('');
      toast.success('Pipeline created');
    } catch {
      toast.error('Could not create pipeline');
    } finally {
      setCreating(false);
    }
  };

  const deletePipeline = async (id: string) => {
    const p = pipelines?.find((x) => x.id === id);
    if (!window.confirm(`Delete "${p?.name ?? 'this pipeline'}" and all its pursuits? This can't be undone.`)) return;
    try {
      await api.del(`/me/pipelines/${id}`);
      setPipelines((cur) => {
        const next = (cur ?? []).filter((x) => x.id !== id);
        if (selectedId === id) setSelectedId(next[0]?.id ?? null);
        return next;
      });
      toast.success('Pipeline deleted');
    } catch {
      toast.error('Could not delete pipeline');
    }
  };

  const addPursuit = async (title: string) => {
    const t = title.trim();
    if (!t || !selectedId) return;
    try {
      const p = await api.post<Pursuit>('/me/pursuits', { pipeline_id: selectedId, title: t });
      setPursuits((cur) => [...(cur ?? []), p]);
      bumpCount(selectedId, +1);
    } catch {
      toast.error('Could not add pursuit');
    }
  };

  const movePursuit = async (pursuit: Pursuit, dir: -1 | 1) => {
    const idx = STAGE_KEYS.indexOf(pursuit.stage);
    const nextIdx = idx + dir;
    if (nextIdx < 0 || nextIdx >= STAGE_KEYS.length) return;
    const nextStage = STAGE_KEYS[nextIdx];
    // Optimistic: move the card now, revert if the write fails.
    setPursuits((cur) => (cur ?? []).map((x) => (x.id === pursuit.id ? { ...x, stage: nextStage } : x)));
    try {
      await api.put(`/me/pursuits/${pursuit.id}`, { stage: nextStage });
    } catch (e) {
      setPursuits((cur) => (cur ?? []).map((x) => (x.id === pursuit.id ? { ...x, stage: pursuit.stage } : x)));
      toast.error(e instanceof ApiError ? `Move failed (${e.status})` : 'Move failed');
    }
  };

  const deletePursuit = async (pursuit: Pursuit) => {
    const prev = pursuits;
    setPursuits((cur) => (cur ?? []).filter((x) => x.id !== pursuit.id));
    bumpCount(pursuit.pipeline_id, -1);
    try {
      await api.del(`/me/pursuits/${pursuit.id}`);
    } catch {
      setPursuits(prev ?? []);
      bumpCount(pursuit.pipeline_id, +1);
      toast.error('Could not delete pursuit');
    }
  };

  function bumpCount(pipelineId: string, delta: number) {
    setPipelines((cur) => (cur ?? []).map((p) => (p.id === pipelineId ? { ...p, pursuit_count: Math.max(0, p.pursuit_count + delta) } : p)));
  }

  const selected = pipelines?.find((p) => p.id === selectedId) ?? null;

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Business Development"
        title="Pipelines"
        description="Your capture boards. Track each pursuit across stages — from identified through proposal to won or lost."
      />

      {/* Board picker + create */}
      <section className="flex flex-col gap-3">
        {pipelines == null ? (
          <div className="px-1 py-2 text-sm text-muted">Loading…</div>
        ) : (
          <div className="flex flex-wrap items-center gap-2">
            {pipelines.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => setSelectedId(p.id)}
                className={
                  'inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-medium transition-colors ' +
                  (p.id === selectedId
                    ? 'border-brand-vermilion/60 bg-brand-vermilion/15 text-foreground'
                    : 'border-border bg-brand-teal-deep/30 text-muted-soft hover:bg-brand-teal-deep/50')
                }
              >
                <Briefcase className="h-3.5 w-3.5" />
                {p.name}
                <span className="rounded-full bg-brand-teal-deep/60 px-1.5 text-[11px] tabular-nums text-muted-soft">{p.pursuit_count}</span>
              </button>
            ))}
            {selected && (
              <button
                type="button"
                onClick={() => deletePipeline(selected.id)}
                aria-label="Delete current pipeline"
                title={`Delete "${selected.name}"`}
                className="inline-flex items-center rounded-md border border-border bg-brand-teal-deep/40 p-1.5 text-muted-soft transition-colors hover:bg-brand-vermilion/15 hover:text-brand-vermilion-soft"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            )}
          </div>
        )}

        {/* Inline create */}
        <form
          onSubmit={(e) => { e.preventDefault(); createPipeline(); }}
          className="flex items-center gap-2"
        >
          <input
            type="text"
            value={newName}
            onChange={(e) => setNewName(e.target.value)}
            placeholder="New pipeline name…"
            maxLength={200}
            className="w-full max-w-xs rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-soft outline-none focus:border-brand-vermilion/60"
          />
          <button
            type="submit"
            disabled={creating || !newName.trim()}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30 disabled:opacity-40"
          >
            <Plus className="h-3.5 w-3.5" /> New pipeline
          </button>
        </form>
      </section>

      {/* Board */}
      {pipelines != null && pipelines.length === 0 ? (
        <EmptyState icon={Layers} title="No pipelines yet." message="Create your first capture board above, then add pursuits to track across stages." />
      ) : selected ? (
        <KanbanBoard
          pursuits={pursuits}
          onAdd={addPursuit}
          onMove={movePursuit}
          onDelete={deletePursuit}
        />
      ) : null}
    </div>
  );
}

function KanbanBoard({
  pursuits, onAdd, onMove, onDelete,
}: {
  pursuits: Pursuit[] | null;
  onAdd: (title: string) => void;
  onMove: (p: Pursuit, dir: -1 | 1) => void;
  onDelete: (p: Pursuit) => void;
}) {
  const [addTitle, setAddTitle] = React.useState('');

  if (pursuits == null) {
    return <div className="px-1 py-6 text-sm text-muted">Loading pursuits…</div>;
  }

  const byStage = (key: string) => pursuits.filter((p) => p.stage === key);

  return (
    <div className="flex flex-col gap-4">
      {/* Add a pursuit (lands in "Identified") */}
      <form
        onSubmit={(e) => { e.preventDefault(); onAdd(addTitle); setAddTitle(''); }}
        className="flex items-center gap-2"
      >
        <input
          type="text"
          value={addTitle}
          onChange={(e) => setAddTitle(e.target.value)}
          placeholder="Add a pursuit (title)…"
          maxLength={300}
          className="w-full max-w-md rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-sm text-foreground placeholder:text-muted-soft outline-none focus:border-brand-vermilion/60"
        />
        <button
          type="submit"
          disabled={!addTitle.trim()}
          className="inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30 disabled:opacity-40"
        >
          <Plus className="h-3.5 w-3.5" /> Add pursuit
        </button>
      </form>

      {pursuits.length === 0 && (
        <div className="rounded-md border border-border bg-brand-teal-deep/20 px-4 py-3 text-sm text-muted-soft">
          No pursuits on this board yet. Add one above — it starts in <span className="text-foreground">Identified</span>.
        </div>
      )}

      {/* 7 stage columns, horizontally scrollable on small screens */}
      <div className="flex gap-3 overflow-x-auto pb-2">
        {STAGES.map((stage, colIdx) => {
          const cards = byStage(stage.key);
          return (
            <div key={stage.key} className="flex w-64 shrink-0 flex-col gap-2">
              <div className="flex items-center justify-between px-1">
                <span className={
                  'text-[11px] font-bold uppercase tracking-[0.12em] ' +
                  (stage.key === 'won' ? 'text-brand-teal-soft' : stage.key === 'lost' ? 'text-muted' : 'text-muted-soft')
                }>
                  {stage.label}
                </span>
                <span className="text-[11px] tabular-nums text-muted">{cards.length}</span>
              </div>
              <div className="flex min-h-[60px] flex-col gap-2 rounded-xl border border-border bg-brand-teal-deep/15 p-2">
                {cards.map((p) => (
                  <PursuitCard
                    key={p.id}
                    pursuit={p}
                    canLeft={colIdx > 0}
                    canRight={colIdx < STAGES.length - 1}
                    onMove={onMove}
                    onDelete={onDelete}
                  />
                ))}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PursuitCard({
  pursuit, canLeft, canRight, onMove, onDelete,
}: {
  pursuit: Pursuit;
  canLeft: boolean;
  canRight: boolean;
  onMove: (p: Pursuit, dir: -1 | 1) => void;
  onDelete: (p: Pursuit) => void;
}) {
  return (
    <div className="group rounded-lg border border-border bg-brand-teal-deep/40 p-2.5">
      <div className="mb-1.5 text-sm font-medium leading-snug text-foreground">{pursuit.title}</div>
      <div className="mb-2 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-muted-soft">
        {pursuit.entity_type && (
          <span className="rounded-full bg-brand-teal-soft/20 px-1.5 py-px uppercase tracking-wide">{pursuit.entity_type}</span>
        )}
        <span>added {fmtDate(pursuit.created_at)}</span>
      </div>
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-1">
          <button
            type="button"
            disabled={!canLeft}
            onClick={() => onMove(pursuit, -1)}
            aria-label="Move to previous stage"
            className="inline-flex items-center rounded border border-border bg-brand-teal-deep/50 p-1 text-muted-soft transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronLeft className="h-3.5 w-3.5" />
          </button>
          <button
            type="button"
            disabled={!canRight}
            onClick={() => onMove(pursuit, 1)}
            aria-label="Move to next stage"
            className="inline-flex items-center rounded border border-border bg-brand-teal-deep/50 p-1 text-muted-soft transition-colors hover:text-foreground disabled:opacity-30"
          >
            <ChevronRight className="h-3.5 w-3.5" />
          </button>
        </div>
        <button
          type="button"
          onClick={() => onDelete(pursuit)}
          aria-label="Delete pursuit"
          className="inline-flex items-center rounded p-1 text-muted-soft opacity-0 transition-opacity hover:text-brand-vermilion-soft group-hover:opacity-100"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}
