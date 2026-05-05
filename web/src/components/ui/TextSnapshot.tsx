import { cn } from '@/lib/utils';
import { Sparkles } from 'lucide-react';

/**
 * TextSnapshot (#10 in spec shared components) — short AI-extracted excerpt
 * shown inline in document list rows. Spec §3.8 shows these on the
 * /document/, /people/.docs and tab tables.
 *
 * Renders the snippet with a subtle border + sparkle accent so users can
 * tell it's AI-generated.
 */
export function TextSnapshot({
  text,
  className,
  maxChars = 280,
}: {
  text: string | null | undefined;
  className?: string;
  maxChars?: number;
}) {
  if (!text) return null;
  const truncated = text.length > maxChars ? text.slice(0, maxChars).trimEnd() + '…' : text;
  return (
    <div
      className={cn(
        'mt-1.5 flex items-start gap-2 rounded-md border border-border/60 bg-brand-teal-deep/25 px-2.5 py-1.5 text-[12px] leading-relaxed text-muted',
        className,
      )}
    >
      <Sparkles className="mt-0.5 h-3 w-3 shrink-0 text-brand-vermilion-soft" />
      <span>{truncated}</span>
    </div>
  );
}
