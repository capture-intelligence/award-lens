import * as React from 'react';

/**
 * Standard page header used by every top-level page.
 *
 *   <PageHeader
 *     eyebrow="Explore"
 *     title="Awards"
 *     description="Replicated contract and assistance awards…"
 *     actions={<Button>Refresh</Button>}
 *   />
 */
export function PageHeader({
  eyebrow,
  title,
  description,
  actions,
}: {
  eyebrow?: string;
  title: string;
  description?: string;
  actions?: React.ReactNode;
}) {
  return (
    <header className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
      <div>
        {eyebrow && (
          <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-brand-sage">
            {eyebrow}
          </div>
        )}
        <h1 className="mt-1 text-3xl font-black tracking-tight text-foreground">{title}</h1>
        {description && (
          <p className="mt-2 max-w-2xl text-sm text-muted">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </header>
  );
}
