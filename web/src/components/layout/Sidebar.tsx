import * as React from 'react';
import {
  Award,
  CalendarClock,
  Building2,
  ShieldAlert,
  Sparkles,
  Activity,
  CalendarRange,
  History,
  Users,
  Database,
  Inbox,
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
      { to: '#/',              label: 'Views',         icon: Database },
      { to: '#/awards',        label: 'Awards',        icon: Award },
      { to: '#/expiring',      label: 'Expiring Soon', icon: CalendarClock },
      { to: '#/vendors',       label: 'Vendors',       icon: Building2 },
      { to: '#/exclusions',    label: 'Exclusions',    icon: ShieldAlert },
      { to: '#/opportunities', label: 'Opportunities', icon: Sparkles },
    ],
  },
  {
    title: 'Operate',
    items: [
      { to: '#/quality',  label: 'Data Quality', icon: Activity },
      { to: '#/schedule', label: 'Schedule',     icon: CalendarRange },
      { to: '#/runs',     label: 'Runs',         icon: History },
    ],
  },
  {
    title: 'Admin',
    items: [
      { to: '#/admin/users',           label: 'Users',           icon: Users,    adminOnly: true },
      { to: '#/admin/views',           label: 'Views',           icon: Database, adminOnly: true },
      { to: '#/admin/access-requests', label: 'Access requests', icon: Inbox,    adminOnly: true },
    ],
  },
];

export function Sidebar({ currentRoute }: { currentRoute: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  const visibleSections = SECTIONS
    .map((s) => ({ ...s, items: s.items.filter((i) => !i.adminOnly || isAdmin) }))
    .filter((s) => s.items.length > 0);

  return (
    <aside className="hidden w-60 shrink-0 border-r border-border bg-brand-teal-deep/35 backdrop-blur-md md:block">
      <nav className="flex h-full flex-col gap-6 px-3 py-6">
        {visibleSections.map((section) => (
          <div key={section.title}>
            <div className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-soft">
              {section.title}
            </div>
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = matchesRoute(currentRoute, item.to);
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <a
                      href={item.to}
                      className={cn(
                        'group flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition-all',
                        isActive
                          ? 'bg-gradient-to-r from-brand-vermilion/20 to-transparent text-foreground ring-1 ring-brand-vermilion/30'
                          : 'text-muted hover:bg-brand-teal-soft/20 hover:text-foreground',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 transition-colors',
                          isActive ? 'text-brand-vermilion' : 'text-muted-soft group-hover:text-brand-sage',
                        )}
                      />
                      <span className="font-medium">{item.label}</span>
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
