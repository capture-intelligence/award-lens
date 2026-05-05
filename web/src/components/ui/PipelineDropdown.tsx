import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Briefcase, Plus, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * PipelineDropdown (#6 in spec shared components) — action dropdown to add
 * an entity to an existing pipeline or create a new one.
 *
 * DIFFERENTIATION: HigherGov forces "create a pipeline before any pursuit."
 * This dropdown supports a "Quick Pipeline" auto-creation on first click —
 * see spec §DIFFERENTIATION item 7.
 */

export interface PipelineSummary {
  pipeline_id: string;
  title: string;
}

export interface PipelineDropdownProps {
  /** Pipelines available to the current user/org. */
  pipelines: PipelineSummary[];
  /** Triggered when the user picks a pipeline. */
  onSelect: (pipelineId: string) => Promise<void> | void;
  /** Triggered when the user wants to create a new pipeline. */
  onCreateNew: () => void;
  /** Loading flag (pipelines list still fetching). */
  isLoading?: boolean;
  /** Whether the entity is already in any pipeline (changes label). */
  isInPipeline?: boolean;
  className?: string;
}

export function PipelineDropdown({
  pipelines, onSelect, onCreateNew, isLoading, isInPipeline, className,
}: PipelineDropdownProps) {
  const [busyId, setBusyId] = React.useState<string | null>(null);

  const handle = async (id: string) => {
    setBusyId(id);
    try { await onSelect(id); } finally { setBusyId(null); }
  };

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'inline-flex items-center gap-1.5 rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] font-medium text-foreground transition-colors hover:bg-brand-teal-soft/30',
            isInPipeline && 'border-brand-sage/40 bg-brand-sage/15 text-brand-sage',
            className,
          )}
        >
          <Briefcase className="h-3.5 w-3.5" />
          {isInPipeline ? 'In pipeline' : 'Add to pipeline'}
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="end" sideOffset={6}
          className="z-50 min-w-[260px] overflow-hidden rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="border-b border-border/60 px-3 py-2 text-[11px] font-bold uppercase tracking-[0.10em] text-muted-soft">
            Add to pipeline
          </div>

          {isLoading ? (
            <div className="flex items-center gap-2 px-3 py-3 text-[12px] text-muted">
              <Loader2 className="h-3 w-3 animate-spin" /> Loading…
            </div>
          ) : pipelines.length === 0 ? (
            <div className="px-3 py-3 text-[12px] text-muted">
              No pipelines yet.
            </div>
          ) : (
            pipelines.map((p) => (
              <DropdownMenu.Item
                key={p.pipeline_id}
                className="flex cursor-pointer items-center justify-between rounded-md px-3 py-2 text-[13px] outline-none data-[highlighted]:bg-brand-teal-soft/30"
                onSelect={(e) => { e.preventDefault(); handle(p.pipeline_id); }}
              >
                <span className="truncate">{p.title}</span>
                {busyId === p.pipeline_id && <Loader2 className="h-3 w-3 animate-spin text-muted-soft" />}
              </DropdownMenu.Item>
            ))
          )}

          <div className="my-1 h-px bg-border/60" />

          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-[13px] text-brand-vermilion-soft outline-none data-[highlighted]:bg-brand-vermilion/15"
            onSelect={() => onCreateNew()}
          >
            <Plus className="h-3.5 w-3.5" />
            Create new pipeline
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
