import * as React from 'react';
import { cn } from '@/lib/utils';

export const Card = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement> & { variant?: 'default' | 'hero' | 'subtle' }
>(({ className, variant = 'default', ...props }, ref) => (
  <div
    ref={ref}
    className={cn(
      'relative overflow-hidden rounded-xl border shadow-glass transition-colors',
      variant === 'default' && 'glass border-border hover:border-border-strong',
      variant === 'hero' &&
        'border-brand-vermilion/30 bg-gradient-to-br from-brand-vermilion/15 via-brand-teal/40 to-brand-teal-deep backdrop-blur-glass',
      variant === 'subtle' && 'border-border bg-brand-teal-deep/40 backdrop-blur-md',
      className,
    )}
    {...props}
  />
));
Card.displayName = 'Card';

export const CardHeader = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex flex-col space-y-1.5 p-6 pb-3', className)} {...props} />
));
CardHeader.displayName = 'CardHeader';

export const CardTitle = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLHeadingElement>
>(({ className, ...props }, ref) => (
  <div
    ref={ref}
    className={cn('text-[11px] font-bold uppercase tracking-[0.14em] text-muted', className)}
    {...props}
  />
));
CardTitle.displayName = 'CardTitle';

export const CardDescription = React.forwardRef<
  HTMLParagraphElement,
  React.HTMLAttributes<HTMLParagraphElement>
>(({ className, ...props }, ref) => (
  <p ref={ref} className={cn('text-xs text-muted', className)} {...props} />
));
CardDescription.displayName = 'CardDescription';

export const CardContent = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('p-6 pt-0', className)} {...props} />
));
CardContent.displayName = 'CardContent';

export const CardFooter = React.forwardRef<
  HTMLDivElement,
  React.HTMLAttributes<HTMLDivElement>
>(({ className, ...props }, ref) => (
  <div ref={ref} className={cn('flex items-center p-6 pt-0', className)} {...props} />
));
CardFooter.displayName = 'CardFooter';

/** Stat card — used heavily on Overview. */
export function Stat({
  label, value, sub, accent = 'default', icon: Icon, className,
}: {
  label: string;
  value: React.ReactNode;
  sub?: React.ReactNode;
  accent?: 'default' | 'vermilion' | 'sage' | 'warning' | 'muted';
  icon?: React.ComponentType<{ className?: string }>;
  className?: string;
}) {
  const accentTextClass = {
    default:   'text-brand-cream',
    vermilion: 'text-brand-vermilion-soft',
    sage:      'text-brand-sage',
    warning:   'text-warning',
    muted:     'text-muted',
  }[accent];
  const accentBadgeClass = {
    default:   'bg-brand-teal-soft/30 text-brand-cream ring-border-strong',
    vermilion: 'bg-brand-vermilion/15 text-brand-vermilion-soft ring-brand-vermilion/40',
    sage:      'bg-brand-sage/15 text-brand-sage ring-brand-sage/40',
    warning:   'bg-warning/15 text-warning ring-warning/40',
    muted:     'bg-brand-teal-deep/40 text-muted ring-border',
  }[accent];
  return (
    <Card className={cn('group', className)}>
      <div className="p-6">
        <div className="flex items-start justify-between gap-3">
          <div className="text-[11px] font-bold uppercase tracking-[0.14em] text-muted">
            {label}
          </div>
          {Icon && (
            <span className={cn('grid h-8 w-8 place-items-center rounded-lg ring-1', accentBadgeClass)}>
              <Icon className="h-4 w-4" />
            </span>
          )}
        </div>
        <div className={cn('mt-3 font-display text-[32px] font-extrabold tracking-tight leading-none', accentTextClass)}>
          {value}
        </div>
        {sub != null && <div className="mt-2 text-xs text-muted">{sub}</div>}
      </div>
    </Card>
  );
}
