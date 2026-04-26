import * as React from 'react';
import { cn } from '@/lib/utils';

export const Input = React.forwardRef<HTMLInputElement, React.InputHTMLAttributes<HTMLInputElement>>(
  ({ className, type = 'text', ...props }, ref) => (
    <input
      ref={ref}
      type={type}
      className={cn(
        'flex h-10 w-full rounded-lg border border-border bg-brand-teal-deep/40 px-3.5 py-2 text-sm transition-colors',
        'placeholder:text-muted-soft',
        'focus-visible:outline-none focus-visible:border-brand-sage focus-visible:bg-brand-teal-deep/70',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    />
  ),
);
Input.displayName = 'Input';

export const Select = React.forwardRef<HTMLSelectElement, React.SelectHTMLAttributes<HTMLSelectElement>>(
  ({ className, children, ...props }, ref) => (
    <select
      ref={ref}
      className={cn(
        'flex h-10 w-full rounded-lg border border-border bg-brand-teal-deep/40 px-3.5 py-2 text-sm transition-colors',
        'focus-visible:outline-none focus-visible:border-brand-sage focus-visible:bg-brand-teal-deep/70',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      {...props}
    >
      {children}
    </select>
  ),
);
Select.displayName = 'Select';

export function Label({ className, children, ...props }: React.HTMLAttributes<HTMLLabelElement>) {
  return (
    <label
      className={cn(
        'mb-1.5 block text-[11px] font-semibold uppercase tracking-[0.08em] text-muted',
        className,
      )}
      {...props}
    >
      {children}
    </label>
  );
}
