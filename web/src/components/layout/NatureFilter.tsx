import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsUpDown, Filter, Check, X } from 'lucide-react';
import { useAgency } from '@/lib/agency-context';
import { NATURE_BUCKETS } from '@/lib/nature-of-work';
import { cn } from '@/lib/utils';

/**
 * Top-of-screen Nature-of-work filter — multi-select chip-style picker.
 *
 * Empty selection = "All" (no filtering). Selected buckets gate
 * `filteredRows` upstream, so every Analytics tab honours the choice
 * uniformly. The bucket catalogue is the static export from
 * `lib/nature-of-work` so the dropdown is available before any data
 * loads.
 */
export function NatureFilter() {
  const { active, selectedNatures, setSelectedNatures } = useAgency();

  if (!active) return null;

  const isActive = selectedNatures.size > 0;
  const label = selectedNatures.size === 0
    ? 'All'
    : selectedNatures.size === 1
      ? Array.from(selectedNatures)[0]!
      : `${selectedNatures.size} selected`;

  function toggle(v: string) {
    const next = new Set(selectedNatures);
    if (next.has(v)) next.delete(v); else next.add(v);
    setSelectedNatures(next);
  }

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          type="button"
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/55 px-3 text-sm transition-colors',
            'hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60',
            'min-w-[10rem]',
            isActive && 'border-brand-vermilion/60',
          )}
          aria-label="Filter by nature of work"
        >
          <Filter className={cn('h-4 w-4', isActive ? 'text-brand-vermilion-soft' : 'text-brand-sage')} />
          <span className="flex-1 truncate text-left">{label}</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-soft" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 min-w-[18rem] rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="flex items-center justify-between px-3 py-2">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
              Nature of work
            </span>
            {isActive && (
              <button
                type="button"
                onClick={() => setSelectedNatures(new Set())}
                className="rounded-md border border-border px-2 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-soft transition-colors hover:border-brand-vermilion hover:text-brand-vermilion-soft"
              >
                <X className="mr-1 inline h-3 w-3" /> Clear
              </button>
            )}
          </div>
          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
          {NATURE_BUCKETS.map((value) => {
            const checked = selectedNatures.has(value);
            return (
              <DropdownMenu.CheckboxItem
                key={value}
                checked={checked}
                onCheckedChange={() => toggle(value)}
                onSelect={(e) => e.preventDefault()}
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
              >
                <span className={cn(
                  'flex h-4 w-4 items-center justify-center rounded border',
                  checked ? 'border-brand-vermilion bg-brand-vermilion' : 'border-border',
                )}>
                  {checked && <Check className="h-3 w-3 text-white" />}
                </span>
                <span className="flex-1">{value}</span>
              </DropdownMenu.CheckboxItem>
            );
          })}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
