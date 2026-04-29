import { LogOut, Settings, Bell } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';
import { Avatar, AvatarFallback, AvatarImage } from '@/components/ui/Avatar';
import { Button } from '@/components/ui/Button';
import { RoleBadge } from '@/components/ui/Badge';
import { Logo, Wordmark } from '@/components/ui/Logo';
import { useAuth } from '@/lib/auth-context';
import { initials } from '@/lib/utils';
import { AgencySelector } from './AgencySelector';
import { CenterSelector } from './CenterSelector';
import { ValueFilter } from './ValueFilter';
import { DateFilter } from './DateFilter';

export function Topbar() {
  const { user, signOut } = useAuth();

  return (
    <header className="sticky top-0 z-30 border-b border-border bg-brand-teal-deep/55 backdrop-blur-xl">
      <div className="flex h-16 items-center gap-4 px-6">
        <BrandMark />

        <div className="hidden flex-1 items-center gap-2 md:flex md:justify-start md:pl-4">
          <AgencySelector />
          <CenterSelector />
          <ValueFilter />
          <DateFilter />
        </div>

        <div className="ml-auto flex items-center gap-2">
          <Button variant="ghost" size="icon" aria-label="Notifications">
            <Bell className="h-4 w-4" />
          </Button>

          {user && (
            <DropdownMenu.Root>
              <DropdownMenu.Trigger asChild>
                <button
                  className="flex items-center gap-3 rounded-full border border-border bg-brand-teal-deep/40 py-1 pl-1 pr-3 transition-colors hover:bg-brand-teal-soft/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60"
                  aria-label="Account menu"
                >
                  <Avatar className="h-8 w-8 ring-0">
                    {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
                    <AvatarFallback>{initials(user.display_name ?? user.email)}</AvatarFallback>
                  </Avatar>
                  <div className="hidden text-left sm:block">
                    <div className="text-xs font-semibold leading-tight text-foreground">
                      {user.display_name ?? user.email}
                    </div>
                    <div className="text-[10px] uppercase tracking-[0.08em] text-muted-soft">
                      {user.email}
                    </div>
                  </div>
                </button>
              </DropdownMenu.Trigger>
              <DropdownMenu.Portal>
                <DropdownMenu.Content
                  align="end"
                  sideOffset={8}
                  className="z-50 min-w-[18rem] overflow-hidden rounded-xl border border-border bg-brand-teal-deep/95 p-1 shadow-glass-lg backdrop-blur-xl"
                >
                  <div className="border-b border-border/60 p-3">
                    <div className="flex items-center gap-3">
                      <Avatar className="h-10 w-10">
                        {user.avatar_url ? <AvatarImage src={user.avatar_url} alt="" /> : null}
                        <AvatarFallback>{initials(user.display_name ?? user.email)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-semibold">{user.display_name ?? '—'}</div>
                        <div className="truncate text-xs text-muted">{user.email}</div>
                      </div>
                    </div>
                    <div className="mt-2 flex items-center gap-2 text-[10px] uppercase tracking-[0.08em] text-muted-soft">
                      <RoleBadge role={user.role} />
                      <span>via {user.provider}</span>
                    </div>
                  </div>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm outline-none data-[highlighted]:bg-brand-teal-soft/30"
                    onSelect={() => { window.location.hash = '#/settings'; }}
                  >
                    <Settings className="h-4 w-4" />
                    Settings
                  </DropdownMenu.Item>
                  <DropdownMenu.Item
                    className="flex cursor-pointer items-center gap-2 rounded-md px-3 py-2 text-sm text-brand-vermilion-soft outline-none data-[highlighted]:bg-brand-vermilion/15"
                    onSelect={() => { void signOut(); }}
                  >
                    <LogOut className="h-4 w-4" />
                    Sign out
                  </DropdownMenu.Item>
                </DropdownMenu.Content>
              </DropdownMenu.Portal>
            </DropdownMenu.Root>
          )}
        </div>
      </div>
    </header>
  );
}

function BrandMark() {
  return (
    <a
      href="#/"
      className="group flex items-center gap-3 rounded-lg px-1 py-1 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/50"
    >
      <Logo size={36} withGlow className="transition-transform duration-300 group-hover:scale-[1.04]" />
      <Wordmark
        size="md"
        tagline="Procurement Intelligence"
        className="hidden sm:flex"
      />
    </a>
  );
}
