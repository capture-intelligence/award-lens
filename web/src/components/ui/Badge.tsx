import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { cn } from '@/lib/utils';

const badgeVariants = cva(
  'inline-flex items-center rounded-full border px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-[0.06em] transition-colors',
  {
    variants: {
      variant: {
        default: 'border-border-strong bg-brand-teal-soft/40 text-foreground',
        success: 'border-success/40 bg-success/15 text-success',
        warning: 'border-warning/40 bg-warning/15 text-warning',
        danger:  'border-brand-vermilion/40 bg-brand-vermilion/15 text-brand-vermilion-soft',
        info:    'border-brand-sage/40 bg-brand-sage/15 text-brand-sage',
        ghost:   'border-transparent bg-transparent text-muted',
        admin:   'border-brand-vermilion/40 bg-brand-vermilion text-brand-cream',
        outline: 'border-border-strong bg-transparent text-muted',
      },
    },
    defaultVariants: { variant: 'default' },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLSpanElement>,
    VariantProps<typeof badgeVariants> {}

export function Badge({ className, variant, ...props }: BadgeProps) {
  return <span className={cn(badgeVariants({ variant }), className)} {...props} />;
}

/** Maps a role string to a badge variant. */
export function RoleBadge({ role }: { role: string }) {
  const variant: BadgeProps['variant'] =
    role === 'admin'   ? 'admin'   :
    role === 'user'    ? 'success' :
    role === 'pending' ? 'warning' :
    role === 'rejected'? 'danger'  : 'default';
  return <Badge variant={variant}>{role}</Badge>;
}

/** Status badge used by Schedule + Runs. */
export function StatusBadge({ status }: { status: string }) {
  const variant: BadgeProps['variant'] =
    status === 'success'  || status === 'healthy'   ? 'success' :
    status === 'running'  || status === 'pending'   ? 'warning' :
    status === 'failed'   || status === 'error'     || status === 'drift' || status === 'rejected' ? 'danger' :
    status === 'never_run'|| status === 'no_data'   ? 'info'    :
    status === 'disabled'                            ? 'ghost'   : 'default';
  return <Badge variant={variant}>{status}</Badge>;
}
