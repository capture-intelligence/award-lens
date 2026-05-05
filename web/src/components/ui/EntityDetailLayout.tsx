import * as React from 'react';
import { ChevronLeft } from 'lucide-react';
import { Link } from 'react-router-dom';
import { cn } from '@/lib/utils';

/**
 * EntityDetailLayout (#3 in spec shared components) — sticky top action bar;
 * two-row tab system (primary + secondary contextual tabs); active tab
 * content area.
 *
 * Spec §3 examples (Contract Opportunity 15 tabs, Awardee 17 tabs, Vehicle
 * 9 tabs, NSN 12 tabs, etc.) all share this same shell — only the actions,
 * tab labels, and content vary.
 */

export interface ActionBarProps {
  /** Primary action buttons rendered at the right edge of the action bar. */
  actions: React.ReactNode;
  /** Optional back-link rendered at the left ("← Awardees"). */
  back?: { label: string; to: string };
  /** Title rendered above the tabs. */
  title: string;
  /** Optional subtitle (e.g. UEI / CAGE / agency code). */
  subtitle?: React.ReactNode;
  /** Optional pill / status badge. */
  pill?: React.ReactNode;
}

export interface TabDef {
  id: string;
  label: string;
  /** Optional count badge — e.g., 'Bidders (12)'. */
  count?: number;
  /** Marks tabs that aren't yet implemented (renders disabled-look). */
  disabled?: boolean;
}

export interface EntityDetailLayoutProps extends ActionBarProps {
  primaryTabs: TabDef[];
  secondaryTabs?: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  children: React.ReactNode;
}

export function EntityDetailLayout({
  back, title, subtitle, pill, actions,
  primaryTabs, secondaryTabs, activeTab, onTabChange, children,
}: EntityDetailLayoutProps) {
  return (
    <div className="flex flex-col gap-4">
      {/* Sticky top action bar */}
      <div className="sticky top-0 z-20 -mx-6 border-b border-border bg-brand-teal-deep/90 px-6 py-3 backdrop-blur-md">
        <div className="flex flex-wrap items-center gap-3">
          <div className="min-w-0 flex-1">
            {back && (
              <Link
                to={back.to}
                className="mb-1 inline-flex items-center gap-1 text-[11px] font-semibold uppercase tracking-[0.08em] text-muted-soft transition-colors hover:text-foreground"
              >
                <ChevronLeft className="h-3 w-3" /> {back.label}
              </Link>
            )}
            <div className="flex items-center gap-2">
              <h1 className="truncate text-lg font-bold tracking-tight text-foreground sm:text-xl">
                {title}
              </h1>
              {pill}
            </div>
            {subtitle && (
              <div className="mt-0.5 truncate text-xs text-muted-soft">{subtitle}</div>
            )}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">{actions}</div>
        </div>
      </div>

      {/* Tab rows */}
      <TabBar tabs={primaryTabs} activeTab={activeTab} onTabChange={onTabChange} variant="primary" />
      {secondaryTabs && secondaryTabs.length > 0 && (
        <TabBar tabs={secondaryTabs} activeTab={activeTab} onTabChange={onTabChange} variant="secondary" />
      )}

      {/* Content */}
      <div className="min-h-[40vh]">{children}</div>
    </div>
  );
}

// ─── Tab bar (used by both rows) ───────────────────────────────────────────
function TabBar({
  tabs, activeTab, onTabChange, variant,
}: {
  tabs: TabDef[];
  activeTab: string;
  onTabChange: (id: string) => void;
  variant: 'primary' | 'secondary';
}) {
  return (
    <div
      role="tablist"
      className={cn(
        'flex flex-wrap items-center gap-1 border-b border-border/50',
        variant === 'secondary' && '-mt-3',
      )}
    >
      {tabs.map((t) => {
        const isActive = t.id === activeTab;
        return (
          <button
            key={t.id}
            role="tab"
            aria-selected={isActive}
            disabled={t.disabled}
            onClick={() => !t.disabled && onTabChange(t.id)}
            className={cn(
              'group relative flex items-center gap-1.5 px-3 py-2 text-[13px] font-medium transition-colors',
              isActive
                ? 'text-foreground'
                : 'text-muted-soft hover:text-foreground',
              t.disabled && 'cursor-not-allowed opacity-40',
              variant === 'primary' ? 'text-[13px]' : 'text-[12px] tracking-wide',
            )}
          >
            {t.label}
            {typeof t.count === 'number' && (
              <span className="rounded-full bg-brand-teal-soft/30 px-1.5 py-px text-[10px] font-semibold tabular-nums text-muted-soft">
                {t.count.toLocaleString()}
              </span>
            )}
            {isActive && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-vermilion" />
            )}
          </button>
        );
      })}
    </div>
  );
}
