import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { ChevronsUpDown, Database, Plus, Sparkles } from 'lucide-react';
import { useViews } from '@/lib/view-context';
import { useAuth } from '@/lib/auth-context';
import { navigate } from '@/lib/router';
import { cn } from '@/lib/utils';

export function ViewSelector() {
  const { available, active, setActive, loading } = useViews();
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  if (loading) {
    return (
      <div className="hidden h-10 w-56 animate-pulse rounded-lg border border-border bg-brand-teal-deep/40 md:block" />
    );
  }

  // No views available at all (and not admin) — hide the selector. The
  // BrowseViews page nudges them.
  if (available.length === 0 && !isAdmin) return null;

  return (
    <DropdownMenu.Root>
      <DropdownMenu.Trigger asChild>
        <button
          className={cn(
            'flex h-10 items-center gap-2 rounded-lg border border-border bg-brand-teal-deep/55 px-3 text-sm transition-colors',
            'hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60',
            'min-w-[14rem]',
          )}
          aria-label="Select view"
        >
          <Database className="h-4 w-4 text-brand-sage" />
          <span className="flex-1 truncate text-left font-semibold">
            {active ? active.name : (isAdmin ? 'All views (admin)' : 'Select a view…')}
          </span>
          <ChevronsUpDown className="h-4 w-4 text-muted-soft" />
        </button>
      </DropdownMenu.Trigger>
      <DropdownMenu.Portal>
        <DropdownMenu.Content
          align="start"
          sideOffset={8}
          className="z-50 max-h-[60vh] min-w-[20rem] overflow-y-auto rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
        >
          {isAdmin && (
            <DropdownMenu.Item
              className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
              onSelect={() => setActive(null)}
            >
              <Sparkles className="h-4 w-4 text-brand-vermilion-soft" />
              <span className="font-semibold">All views (unscoped)</span>
              {!active && <span className="ml-auto text-[10px] uppercase tracking-[0.08em] text-brand-sage">active</span>}
            </DropdownMenu.Item>
          )}

          {available.length > 0 && (
            <>
              {isAdmin && <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />}
              {available.map((v) => (
                <DropdownMenu.Item
                  key={v.view_id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
                  onSelect={() => setActive(v.view_id)}
                >
                  <Database className="h-4 w-4 text-brand-sage" />
                  <div className="min-w-0 flex-1">
                    <div className="truncate font-semibold">{v.name}</div>
                    {v.description && (
                      <div className="truncate text-[11px] text-muted-soft">{v.description}</div>
                    )}
                  </div>
                  {active?.view_id === v.view_id && (
                    <span className="text-[10px] uppercase tracking-[0.08em] text-brand-sage">active</span>
                  )}
                </DropdownMenu.Item>
              ))}
            </>
          )}

          <DropdownMenu.Separator className="mx-2 my-1 h-px bg-border" />
          <DropdownMenu.Item
            className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
            onSelect={() => navigate('/views')}
          >
            <Plus className="h-4 w-4" />
            Browse all views
          </DropdownMenu.Item>
        </DropdownMenu.Content>
      </DropdownMenu.Portal>
    </DropdownMenu.Root>
  );
}
