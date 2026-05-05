import * as React from 'react';
import { Inbox } from 'lucide-react';
import { cn } from '@/lib/utils';

/**
 * EmptyState (#12 in spec shared components) — never show a blank page.
 * Used by every list page when no rows match the active filters, and by
 * empty pursuit/activity/proposal/etc. tabs.
 */
export interface EmptyStateProps {
  title?: string;
  message?: string;
  /** Optional icon — defaults to a lucide Inbox. */
  icon?: React.ComponentType<{ className?: string }>;
  /** Optional CTA — e.g., "Try Search All" or "Create your first pipeline". */
  action?: React.ReactNode;
  /** Tighter spacing for inline use within tab content. */
  compact?: boolean;
  className?: string;
}

export function EmptyState({
  title = 'Nothing here yet.',
  message = 'Adjust your filters or come back after the next ingestion run.',
  icon: Icon = Inbox,
  action,
  compact = false,
  className,
}: EmptyStateProps) {
  return (
    <div
      className={cn(
        'flex flex-col items-center justify-center text-center',
        compact ? 'gap-3 py-10' : 'gap-4 py-20',
        className,
      )}
    >
      <div className="grid h-14 w-14 place-items-center rounded-full border border-border bg-brand-teal-deep/40 text-muted-soft">
        <Icon className="h-6 w-6" />
      </div>
      <div>
        <h3 className="text-base font-semibold text-foreground">{title}</h3>
        <p className="mt-1 max-w-sm text-sm text-muted">{message}</p>
      </div>
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
