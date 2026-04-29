import * as React from 'react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import * as Slider from '@radix-ui/react-slider';
import { ChevronsUpDown, CalendarRange, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { useAgency, epochDayToDate } from '@/lib/agency-context';
import { cn } from '@/lib/utils';

/**
 * Top-of-screen contract-end-date filter — dual-thumb Radix slider.
 *
 * Bounds (`dateBounds`) come from the loaded /explore data — the page
 * publishes them to context the first time data lands so the slider
 * can anchor. Dragging only updates a local `pending` value; the actual
 * filter state commits on pointer release (onValueCommit) to keep things
 * smooth even with thousands of rows.
 */
export function DateFilter() {
  const { dateBounds, dateRange, setDateRange, active } = useAgency();
  const [pending, setPending] = React.useState<[number, number] | null>(null);

  // Reset the pending value when bounds reset (new agency/center).
  React.useEffect(() => { setPending(null); }, [dateBounds?.min, dateBounds?.max]);

  if (!active) return null;
  if (!dateBounds) {
    // Data hasn't loaded yet — render a placeholder skeleton so the topbar
    // doesn't reflow once it appears.
    return <div className="hidden h-10 w-44 animate-pulse rounded-lg border border-border bg-brand-teal-deep/40 md:block" />;
  }

  const isActive = dateRange != null;
  const display = pending ?? dateRange ?? [dateBounds.min, dateBounds.max];
  const label = isActive
    ? `${epochDayToDate(display[0])} → ${epochDayToDate(display[1])}`
    : 'Any end date';

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/55 px-3 text-sm transition-colors',
            'hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60',
            'min-w-[12rem]',
            isActive && 'border-brand-vermilion/60',
          )}
          aria-label="Filter by contract end date"
        >
          <CalendarRange className={cn('h-4 w-4', isActive ? 'text-brand-vermilion-soft' : 'text-brand-sage')} />
          <span className="flex-1 truncate text-left font-mono text-[11px]">{label}</span>
          <ChevronsUpDown className="h-4 w-4 text-muted-soft" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 min-w-[26rem] rounded-xl border border-border bg-brand-teal-deep/95 p-4 shadow-glass-lg backdrop-blur-xl"
        >
          <div className="mb-2 flex items-baseline justify-between">
            <span className="text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
              Contract end date range
            </span>
            <span className="font-mono text-[11px] text-muted-soft">
              {epochDayToDate(display[0])} → {epochDayToDate(display[1])}
            </span>
          </div>

          {/* Chevrons flank the track to signal "this is a sliding range".
              They sit OUTSIDE the Slider.Root so they don't intercept pointer
              events and never get dragged with the thumbs. */}
          <div className="flex items-center gap-2">
            <ChevronLeft  className="h-4 w-4 shrink-0 text-brand-sage/70" aria-hidden />
            <Slider.Root
              className="relative flex h-7 w-full grow touch-none select-none items-center"
              min={dateBounds.min}
              max={dateBounds.max}
              step={1}
              value={display}
              onValueChange={(v) => {
                if (v.length !== 2) return;
                setPending([v[0]!, v[1]!]);
              }}
              onValueCommit={(v) => {
                if (v.length !== 2) return;
                if (v[0] === dateBounds.min && v[1] === dateBounds.max) {
                  setDateRange(null);
                } else {
                  setDateRange([v[0]!, v[1]!]);
                }
                setPending(null);
              }}
              aria-label="Contract end date range"
            >
              {/* Track is taller (h-1.5) and dashed in the unfilled portions
                  so the "slidable line" reads at a glance even when the
                  range covers most of the available span. */}
              <Slider.Track className="relative h-1.5 grow overflow-hidden rounded-full bg-brand-teal-deep ring-1 ring-inset ring-brand-sage/15">
                <div className="pointer-events-none absolute inset-0 rounded-full bg-[linear-gradient(90deg,rgba(144,174,173,0.0)_0%,rgba(144,174,173,0.35)_50%,rgba(144,174,173,0.0)_100%)]" aria-hidden />
                <Slider.Range className="absolute h-full rounded-full bg-brand-vermilion" />
              </Slider.Track>
              <Slider.Thumb className="block h-4 w-4 rounded-full border-2 border-brand-vermilion bg-brand-cream shadow-md outline-none transition-transform hover:scale-110 focus:ring-2 focus:ring-brand-vermilion/50" />
              <Slider.Thumb className="block h-4 w-4 rounded-full border-2 border-brand-vermilion bg-brand-cream shadow-md outline-none transition-transform hover:scale-110 focus:ring-2 focus:ring-brand-vermilion/50" />
            </Slider.Root>
            <ChevronRight className="h-4 w-4 shrink-0 text-brand-sage/70" aria-hidden />
          </div>

          <div className="mt-3 flex items-center justify-between text-[10px] text-muted-soft">
            <span>Range covers {epochDayToDate(dateBounds.min)} → {epochDayToDate(dateBounds.max)}</span>
            {isActive && (
              <button
                type="button"
                onClick={() => { setDateRange(null); setPending(null); }}
                className="rounded-md border border-border px-2 py-0.5 uppercase tracking-[0.08em] hover:border-brand-vermilion hover:text-brand-vermilion-soft"
              >
                <X className="mr-1 inline h-3 w-3" /> Clear
              </button>
            )}
          </div>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
