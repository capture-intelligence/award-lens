import * as React from 'react';
import {
  TableProperties,
  Briefcase,
  Activity,
  CalendarRange,
  History,
  Users,
  Inbox,
  ChevronsLeft,
  ChevronsRight,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  adminOnly?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

const SECTIONS: NavSection[] = [
  {
    title: 'Explore',
    items: [
      { to: '#/',         label: 'Analytics', icon: TableProperties },
      { to: '#/pipeline', label: 'Pipeline',  icon: Briefcase },
    ],
  },
  {
    title: 'Operate',
    items: [
      { to: '#/quality',  label: 'Data Quality', icon: Activity,      adminOnly: true },
      { to: '#/schedule', label: 'Schedule',     icon: CalendarRange, adminOnly: true },
      { to: '#/runs',     label: 'Runs',         icon: History,       adminOnly: true },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '#/admin/users',           label: 'Users',           icon: Users, adminOnly: true },
      { to: '#/admin/access-requests', label: 'Access requests', icon: Inbox, adminOnly: true },
    ],
  },
];

// Collapsed state is owned by AppShell — see AppShell.tsx — so the main
// column can react and drop its max-width cap when the rail is hidden.
export function Sidebar({
  currentRoute,
  collapsed,
  onToggle,
}: {
  currentRoute: string;
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const visibleSections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.adminOnly || isAdmin) }))
    .filter((s) => s.items.length > 0);

  return (
    <aside
      className={cn(
        'relative hidden shrink-0 border-r border-border bg-brand-teal-deep/35 backdrop-blur-md md:block',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-60',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-brand-teal-deep text-muted-soft shadow-sm transition-colors hover:border-brand-vermilion hover:text-brand-vermilion-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60"
      >
        {collapsed
          ? <ChevronsRight className="h-3.5 w-3.5" />
          : <ChevronsLeft  className="h-3.5 w-3.5" />}
      </button>

      <nav className={cn('flex h-full flex-col gap-6 py-6', collapsed ? 'px-1.5' : 'px-3')}>
        {visibleSections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-soft">
                {section.title}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = matchesRoute(currentRoute, item.to);
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <a
                      href={item.to}
                      title={collapsed ? item.label : undefined}
                      aria-label={item.label}
                      className={cn(
                        'group flex items-center rounded-lg text-sm transition-all',
                        collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-2',
                        isActive
                          ? 'bg-gradient-to-r from-brand-vermilion/20 to-transparent text-foreground ring-1 ring-brand-vermilion/30'
                          : 'text-muted hover:bg-brand-teal-soft/20 hover:text-foreground',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive ? 'text-brand-vermilion' : 'text-muted-soft group-hover:text-brand-sage',
                        )}
                      />
                      {!collapsed && <span className="font-medium">{item.label}</span>}
                    </a>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}
      </nav>
    </aside>
  );
}

function matchesRoute(current: string, href: string): boolean {
  const target = href.replace(/^#/, '') || '/';
  const cur = current || '/';
  if (target === '/') return cur === '/' || cur === '';
  return cur === target || cur.startsWith(target + '/');
}
