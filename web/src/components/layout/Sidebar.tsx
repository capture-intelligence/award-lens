import * as React from 'react';
import { Link, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Search, FileText, Award as AwardIcon, Briefcase, Activity,
  Users, Building2, FileSearch, Tag, Calendar, History, BookOpen, Bell,
  TrendingUp, MapPin, BarChart3, Truck, Scale, Banknote, ListTree, Layers,
  Megaphone, Newspaper, FileCheck, Bookmark, Download, Settings as SettingsIcon,
  ChevronsLeft, ChevronsRight, Lock, Plus, ShieldAlert, Inbox,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/lib/auth-context';
import { routes } from '@/lib/routes';

/**
 * Sidebar — spec §3.UX (Component Patterns / Left Sidebar Navigation):
 *
 *   EXPLORE
 *     - Dashboard
 *     - Search All
 *
 *   BUSINESS DEVELOPMENT
 *     - Contract Opportunities
 *     - Grant Opportunities
 *     - Forecasts
 *     - Pipeline       (+ inline create)
 *     - Pursuits       (+ inline create)
 *     - Activities     (+ inline create)
 *     - Partner Finder
 *     - Government Buyers
 *     - Labor Pricing
 *
 *   MARKET INTELLIGENCE
 *     - Market Analysis
 *     - Contract Awards
 *     - Grant Awards
 *     - Vehicles
 *     - Awardees
 *     - Agencies
 *     - People
 *     - Documents
 *     - Reference data sub-section (collapsed by default)
 *
 *   CAPITAL MARKETS  (Leader-tier — locked icon)
 *     - M&A Transactions
 *     - Investors
 *     - Advisors
 *
 *   TOOLS
 *     - Favorites
 *     - Saved Searches
 *     - Proposals
 *     - FOIA Requests
 *     - News
 *     - Downloads
 *
 *   ADMIN  (admin role only)
 *     - Users
 *     - Access requests
 *     - Data Quality
 *     - Schedule
 *     - Runs
 */

interface NavItem {
  to: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  /** Show next to the label, e.g., 'Leader' or '5.7M'. */
  pill?: string;
  /** Hidden unless current user role >= admin. */
  adminOnly?: boolean;
  /** Inline [+] button next to the label that emits a custom action. */
  quickCreate?: () => void;
  /** Render a 🔒 — used for paywalled sections on lower tiers. */
  locked?: boolean;
}

interface NavSection {
  title: string;
  items: NavItem[];
}

function buildSections(opts: { isAdmin: boolean; isLeader: boolean }): NavSection[] {
  const { isAdmin, isLeader } = opts;
  return [
    {
      title: 'Explore',
      items: [
        { to: routes.home,        label: 'Dashboard',  icon: LayoutDashboard },
        { to: routes.searchAll,   label: 'Search All', icon: Search },
      ],
    },
    {
      title: 'Business Development',
      items: [
        { to: routes.contractOpps,    label: 'Contract Opportunities', icon: FileText },
        { to: routes.grantOpps,       label: 'Grant Opportunities',    icon: BookOpen },
        { to: routes.forecasts,       label: 'Forecasts',              icon: Calendar },
        { to: routes.pipelines,       label: 'Pipelines',              icon: Briefcase },
        { to: routes.pursuits,        label: 'Pursuits',               icon: TrendingUp },
        { to: routes.activities,      label: 'Activities',             icon: Activity },
        { to: routes.partnerFinder,   label: 'Partner Finder',         icon: Users },
        { to: routes.governmentBuyers,label: 'Government Buyers',      icon: Building2 },
        { to: routes.laborPricing,    label: 'Labor Pricing',          icon: Banknote },
      ],
    },
    {
      title: 'Market Intelligence',
      items: [
        { to: routes.marketAnalysis,  label: 'Market Analysis',  icon: BarChart3 },
        { to: routes.contractAwards,  label: 'Contract Awards',  icon: AwardIcon },
        { to: routes.grantAwards,     label: 'Grant Awards',     icon: AwardIcon },
        { to: routes.vehicles,        label: 'Vehicles',         icon: Truck },
        { to: routes.awardees,        label: 'Awardees',         icon: Building2 },
        { to: routes.agencies,        label: 'Agencies',         icon: Building2 },
        { to: routes.people,          label: 'People',           icon: Users },
        { to: routes.documents,       label: 'Documents',        icon: FileSearch },
        { to: routes.protests,        label: 'Protests',         icon: ShieldAlert },
        { to: routes.naics,           label: 'NAICS',            icon: Tag },
        { to: routes.psc,             label: 'PSC',              icon: Tag },
        { to: routes.cfda,            label: 'CFDA',             icon: ListTree },
        { to: routes.defensePrograms, label: 'Defense Programs', icon: Layers },
        { to: routes.itPrograms,      label: 'IT Programs',      icon: Layers },
        { to: routes.budget,          label: 'DoD Budget',       icon: Banknote },
        { to: routes.nia,             label: 'NIA',              icon: Tag },
        { to: routes.nsn,             label: 'NSN',              icon: Tag },
        { to: routes.sewp,            label: 'SEWP Catalog',     icon: Tag },
      ],
    },
    {
      title: 'Capital Markets',
      items: [
        { to: routes.transactions, label: 'M&A Transactions', icon: Scale,    locked: !isLeader, pill: 'Leader' },
        { to: routes.investors,    label: 'Investors',        icon: Banknote, locked: !isLeader, pill: 'Leader' },
        { to: routes.advisors,     label: 'Advisors',         icon: Megaphone,locked: !isLeader, pill: 'Leader' },
      ],
    },
    {
      title: 'Tools',
      items: [
        { to: routes.savedSearches, label: 'Saved Searches', icon: Bell },
        { to: routes.favorites,     label: 'Favorites',      icon: Bookmark },
        { to: routes.proposals,     label: 'Proposals',      icon: FileCheck },
        { to: routes.foia,          label: 'FOIA Requests',  icon: MapPin },
        { to: routes.news,          label: 'News',           icon: Newspaper },
        { to: routes.downloads,     label: 'Downloads',      icon: Download },
      ],
    },
    ...(isAdmin ? [{
      title: 'Admin',
      items: [
        { to: routes.adminUsers,   label: 'Users',           icon: Users, adminOnly: true },
        { to: routes.adminAccess,  label: 'Access requests', icon: Inbox, adminOnly: true },
        { to: routes.quality,      label: 'Data Quality',    icon: Activity,      adminOnly: true },
        { to: routes.schedule,     label: 'Schedule',        icon: Calendar,      adminOnly: true },
        { to: routes.runs,         label: 'Runs',            icon: History,       adminOnly: true },
      ] satisfies NavItem[],
    }] : []),
  ];
}

export function Sidebar({
  collapsed,
  onToggle,
}: {
  collapsed: boolean;
  onToggle: () => void;
}) {
  const { user } = useAuth();
  const { pathname } = useLocation();
  const isAdmin  = user?.role === 'admin';
  // Leader-tier check: org plan field — fall back to false until hooked up.
  const isLeader = false;

  const sections = buildSections({ isAdmin, isLeader });

  return (
    <aside
      className={cn(
        'relative hidden shrink-0 border-r border-border bg-brand-teal-deep/35 backdrop-blur-md md:block',
        'transition-[width] duration-200 ease-out',
        collapsed ? 'w-14' : 'w-64',
      )}
    >
      <button
        type="button"
        onClick={onToggle}
        aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        className="absolute -right-3 top-5 z-10 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-brand-teal-deep text-muted-soft shadow-sm transition-colors hover:border-brand-vermilion hover:text-brand-vermilion-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-sage/60"
      >
        {collapsed ? <ChevronsRight className="h-3.5 w-3.5" /> : <ChevronsLeft className="h-3.5 w-3.5" />}
      </button>

      <nav
        className={cn(
          'flex h-full flex-col gap-5 overflow-y-auto py-5',
          collapsed ? 'px-1.5' : 'px-3',
        )}
      >
        {sections.map((section) => (
          <div key={section.title}>
            {!collapsed && (
              <div className="mb-1.5 flex items-center justify-between px-3 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-soft">
                {section.title}
              </div>
            )}
            <ul className="flex flex-col gap-0.5">
              {section.items.map((item) => {
                const isActive = matchesRoute(pathname, item.to);
                const Icon = item.icon;
                return (
                  <li key={item.to}>
                    <Link
                      to={item.to}
                      title={collapsed ? item.label : undefined}
                      aria-label={item.label}
                      className={cn(
                        'group flex items-center rounded-lg text-sm transition-all',
                        collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-1.5',
                        isActive
                          ? 'bg-gradient-to-r from-brand-vermilion/20 to-transparent text-foreground ring-1 ring-brand-vermilion/30'
                          : 'text-muted hover:bg-brand-teal-soft/20 hover:text-foreground',
                        item.locked && 'opacity-60',
                      )}
                    >
                      <Icon
                        className={cn(
                          'h-4 w-4 shrink-0 transition-colors',
                          isActive ? 'text-brand-vermilion' : 'text-muted-soft group-hover:text-brand-sage',
                        )}
                      />
                      {!collapsed && (
                        <>
                          <span className="flex-1 truncate font-medium">{item.label}</span>
                          {item.locked && <Lock className="h-3 w-3 text-muted-soft" />}
                          {item.pill && (
                            <span className={cn(
                              'rounded-full px-1.5 py-px text-[9px] font-bold uppercase tracking-wider',
                              item.locked
                                ? 'bg-muted/15 text-muted-soft'
                                : 'bg-brand-vermilion/20 text-brand-vermilion-soft',
                            )}>
                              {item.pill}
                            </span>
                          )}
                          {item.quickCreate && (
                            <button
                              type="button"
                              onClick={(e) => { e.preventDefault(); item.quickCreate!(); }}
                              aria-label={`Create new ${item.label.toLowerCase()}`}
                              className="rounded p-0.5 text-muted-soft transition-colors hover:bg-brand-vermilion/20 hover:text-brand-vermilion-soft"
                            >
                              <Plus className="h-3 w-3" />
                            </button>
                          )}
                        </>
                      )}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </div>
        ))}

        {/* Settings — anchored to the bottom */}
        <div className="mt-auto">
          <Link
            to={routes.settings}
            title={collapsed ? 'Settings' : undefined}
            aria-label="Settings"
            className={cn(
              'group flex items-center rounded-lg text-sm transition-all',
              collapsed ? 'justify-center px-2 py-2' : 'gap-3 px-3 py-1.5',
              matchesRoute(pathname, routes.settings)
                ? 'bg-gradient-to-r from-brand-vermilion/20 to-transparent text-foreground ring-1 ring-brand-vermilion/30'
                : 'text-muted hover:bg-brand-teal-soft/20 hover:text-foreground',
            )}
          >
            <SettingsIcon className={cn(
              'h-4 w-4 shrink-0',
              matchesRoute(pathname, routes.settings) ? 'text-brand-vermilion' : 'text-muted-soft group-hover:text-brand-sage',
            )} />
            {!collapsed && <span className="font-medium">Settings</span>}
          </Link>
        </div>
      </nav>
    </aside>
  );
}

function matchesRoute(currentPath: string, target: string): boolean {
  const current = currentPath || '/';
  if (target === '/') return current === '/' || current === '';
  return current === target || current.startsWith(target + '/');
}
