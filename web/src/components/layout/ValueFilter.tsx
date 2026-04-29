import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsUpDown, DollarSign, X } from 'lucide-react';
import { useAgency } from '@/lib/agency-context';
import { fmtMoney, cn } from '@/lib/utils';

/**
 * Top-of-screen value filter — current_value range.
 * Compact trigger; full min/max editor lives in a Radix popover.
 *
 * State (minValue / maxValue strings) is owned by agency-context so the
 * filter applies uniformly across Pivot / Summary / Tree.
 */
export function ValueFilter() {
  const { minValue, maxValue, setMinValue, setMaxValue, active } = useAgency();

  // Hide when nothing's loaded yet — prevents flash on first paint.
  if (!active) return null;

  const minNum = minValue.trim() === '' ? null : Number(minValue);
  const maxNum = maxValue.trim() === '' ? null : Number(maxValue);
  const isActive = minNum != null || maxNum != null;

  const label = (() => {
    if (!isActive) return 'Any value';
    if (minNum != null && maxNum != null) return `${fmtMoney(minNum)} – ${fmtMoney(maxNum)}`;
    if (minNum != null) return `≥ ${fmtMoney(minNum)}`;
    return `≤ ${fmtMoney(maxNum!)}`;
  })();

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/55 px-3 text-sm transition-colors',
            'hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60',
            'min-w-[10rem]',
            isActive && 'border-brand-vermilion/60',
          )}
          aria-label="Filter by contract value"
        >
          <DollarSign className={cn('h-4 w-4', isActive ? 'text-brand-vermilion-soft' : 'text-brand-sage')} />
          <span className="flex-1 truncate text-left text-xs">{label}</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-soft" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 min-w-[20rem] rounded-xl border border-border bg-brand-teal-deep/95 p-3 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="mb-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            Current value range
          </div>

          <div className="flex items-center gap-1.5">
            <input
              type="text"
              value={minValue}
              onChange={(e) => setMinValue(e.target.value)}
              placeholder="min"
              inputMode="numeric"
              className="h-9 w-24 rounded-md border border-border bg-brand-teal-deep/60 px-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-sage/60"
            />
            <span className="text-xs text-muted-soft">–</span>
            <input
              type="text"
              value={maxValue}
              onChange={(e) => setMaxValue(e.target.value)}
              placeholder="max"
              inputMode="numeric"
              className="h-9 w-24 rounded-md border border-border bg-brand-teal-deep/60 px-2 font-mono text-sm focus:outline-none focus:ring-2 focus:ring-brand-sage/60"
            />
            {isActive && (
              <button
                type="button"
                onClick={() => { setMinValue(''); setMaxValue(''); }}
                className="ml-auto rounded-md border border-border px-2 py-1 text-[10px] uppercase tracking-[0.08em] text-muted-soft transition-colors hover:border-brand-vermilion hover:text-brand-vermilion-soft"
                aria-label="Clear value filter"
              >
                <X className="h-3 w-3" />
              </button>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1">
            {[
              { label: '≥ $4M',   min: 4_000_000   },
              { label: '≥ $10M',  min: 10_000_000  },
              { label: '≥ $50M',  min: 50_000_000  },
              { label: '≥ $100M', min: 100_000_000 },
            ].map((p) => (
              <button
                key={p.label}
                type="button"
                onClick={() => { setMinValue(String(p.min)); setMaxValue(''); }}
                className="rounded-md border border-border bg-brand-teal-deep/40 px-1.5 py-0.5 text-[10px] uppercase tracking-[0.08em] text-muted-soft transition-colors hover:border-brand-sage hover:text-foreground"
              >
                {p.label}
              </button>
            ))}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
