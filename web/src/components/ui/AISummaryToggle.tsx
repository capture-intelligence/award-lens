import * as React from 'react';
import { Sparkles } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * AISummaryToggle (#9 in spec shared components) — Original / Summary toggle
 * shown on description fields. Spec §3.2 calls for a sparkle (✦) icon on the
 * Summary side. We use the lucide Sparkles glyph + a vermilion accent.
 *
 * Renders nothing if no AI summary is available — call sites pass
 * `summary={null}` to indicate that.
 */
export interface AISummaryToggleProps {
  original: string;
  summary: string | null;
  defaultMode?: 'original' | 'summary';
  className?: string;
}

export function AISummaryToggle({
  original,
  summary,
  defaultMode = 'summary',
  className,
}: AISummaryToggleProps) {
  const [mode, setMode] = React.useState<'original' | 'summary'>(
    summary ? defaultMode : 'original',
  );

  const hasSummary = Boolean(summary);
  const text = mode === 'summary' && hasSummary ? summary! : original;

  return (
    <div className={cn('flex flex-col gap-3', className)}>
      <div
        role="tablist"
        className="inline-flex items-center self-start rounded-full border border-border bg-brand-teal-deep/35 p-0.5 text-xs"
      >
        <button
          role="tab"
          aria-selected={mode === 'original'}
          onClick={() => setMode('original')}
          className={cn(
            'rounded-full px-3 py-1 font-medium transition-colors',
            mode === 'original'
              ? 'bg-brand-teal-soft/40 text-foreground ring-1 ring-border'
              : 'text-muted hover:text-foreground',
          )}
        >
          Original
        </button>
        <button
          role="tab"
          aria-selected={mode === 'summary'}
          disabled={!hasSummary}
          onClick={() => setMode('summary')}
          title={hasSummary ? 'AI-generated summary' : 'Summary not yet available'}
          className={cn(
            'flex items-center gap-1.5 rounded-full px-3 py-1 font-medium transition-colors',
            mode === 'summary'
              ? 'bg-brand-vermilion/20 text-brand-vermilion-soft ring-1 ring-brand-vermilion/30'
              : 'text-muted hover:text-foreground',
            !hasSummary && 'cursor-not-allowed opacity-50',
          )}
        >
          <Sparkles className="h-3 w-3" />
          Summary
        </button>
      </div>

      <div className="whitespace-pre-wrap text-sm leading-relaxed text-muted">
        {text || (
          <span className="italic text-muted-soft">No description available.</span>
        )}
      </div>
    </div>
  );
}

/** Inline ✦ marker shown next to AI-generated values. */
export function AIBadge({ label = 'AI' }: { label?: string }) {
  return (
    <span
      title="AI-generated"
      className="inline-flex items-center gap-1 rounded-full bg-brand-vermilion/15 px-1.5 py-px text-[10px] font-bold uppercase tracking-[0.08em] text-brand-vermilion-soft ring-1 ring-brand-vermilion/30"
    >
      <Sparkles className="h-2.5 w-2.5" />
      {label}
    </span>
  );
}
