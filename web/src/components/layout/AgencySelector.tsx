import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsUpDown, Building2, Globe2 } from 'lucide-react';
import { useAgency } from '@/lib/agency-context';
import { useAuth } from '@/lib/auth-context';
import { fmtInt } from '@/lib/utils';
import { cn } from '@/lib/utils';

export function AgencySelector() {
  const { agencies, active, setActive, loading } = useAgency();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  if (loading) {
    return (
      <div className="hidden h-10 w-56 animate-pulse rounded-lg border border-border bg-brand-teal-deep/40 md:block" />
    );
  }

  if (agencies.length === 0) return null;

  const activeRow = agencies.find((a) => a.name === active);

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/55 px-3 text-sm transition-colors',
            'hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60',
            'min-w-[16rem]',
          )}
          aria-label="Select awarding agency"
        >
          <Building2 className="h-4 w-4 text-brand-sage" />
          <span className="flex-1 truncate text-left font-semibold">
            {active ?? (isAdmin ? 'All agencies' : 'Pick an agency…')}
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
          className="z-50 max-h-[60vh] min-w-[24rem] overflow-y-auto rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
        >
          {isAdmin && (
            <>
              <DropdownMenu.Item
                className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
                onSelect={() => setActive(null)}
              >
                <Globe2 className="h-4 w-4 text-brand-vermilion-soft" />
                <span className="font-semibold">All agencies (unscoped)</span>
                {active === null && (
                  <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-brand-sage">active</span>
                )}
              </DropdownMenu.Item>
              <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
            </>
          )}

          {agencies.map((a) => (
            <DropdownMenu.Item
              key={a.name}
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
              onSelect={() => setActive(a.name)}
            >
              <Building2 className="h-4 w-4 text-brand-sage" />
              <div className="min-w-0 flex-1">
                <div className="truncate font-semibold">{a.name}</div>
                {a.toptier && a.toptier !== a.name && (
                  <div className="truncate text-[11px] text-muted-soft">{a.toptier}</div>
                )}
              </div>
              <span className="font-mono text-[10px] text-muted-soft">{fmtInt(a.n)}</span>
              {active === a.name && (
                <span className="ml-2 text-[10px] uppercase tracking-[0.08em] text-brand-sage">active</span>
              )}
            </DropdownMenu.Item>
          ))}
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
