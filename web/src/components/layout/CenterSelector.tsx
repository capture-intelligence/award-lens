import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsUpDown, Layers, Globe2 } from 'lucide-react';
import { useAgency } from '@/lib/agency-context';
import { fmtInt, cn } from '@/lib/utils';

/**
 * Center filter — sits beside <AgencySelector> and narrows the dashboard
 * to a single CDC/HHS center within the currently selected awarding
 * agency. The catalog re-fetches whenever the agency changes; selection
 * is remembered per-agency in localStorage.
 *
 * Hidden when no agency is selected (admin "All agencies" mode) — center
 * is meaningless without an agency context.
 */
export function CenterSelector() {
  const { active: activeAgency, centers, activeCenter, centersLoading, setActiveCenter } = useAgency();

  // No agency picked → no center to show.
  if (!activeAgency) return null;

  if (centersLoading) {
    return (
      <div className="hidden h-10 w-44 animate-pulse rounded-lg border border-border bg-brand-teal-deep/40 md:block" />
    );
  }

  if (centers.length === 0) return null;

  const activeRow = centers.find((c) => c.code === activeCenter);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/55 px-3 text-sm transition-colors',
            'hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60',
            'min-w-[12rem]',
          )}
          aria-label="Filter by center"
        >
          <Layers className="h-4 w-4 text-brand-sage" />
          <span className="flex-1 truncate text-left font-semibold">
            {activeRow ? activeRow.code : 'All centers'}
          </span>
          {activeRow && (
            <span className="rounded-md bg-brand-teal-deep/60 px-1.5 py-0.5 font-mono text-[10px] text-muted-soft">
              {fmtInt(activeRow.n)}
            </span>
          )}
          <ChevronsUpDown className="h-4 w-4 text-muted-soft" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 max-h-[60vh] min-w-[22rem] overflow-y-auto rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
        >
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
            onSelect={() => setActiveCenter(null)}
          >
            <Globe2 className="h-4 w-4 text-brand-vermilion-soft" />
            <span className="font-semibold">All centers (no filter)</span>
            {activeCenter === null && (
              <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-brand-sage">active</span>
            )}
          </DropdownMenu.Item>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />

          {centers.map((c) => (
            <DropdownMenu.Item
              key={c.code}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
              onSelect={() => setActiveCenter(c.code)}
            >
              <Layers className="h-4 w-4 text-brand-sage" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-xs font-semibold">{c.code}</div>
                <div className="truncate text-[11px] text-muted-soft">{c.name}</div>
              </div>
              <span className="font-mono text-[10px] text-muted-soft">{fmtInt(c.n)}</span>
              {activeCenter === c.code && (
                <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-brand-sage">active</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
