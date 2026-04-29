import * as React from 'react';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { cn } from '@/lib/utils';

const SIDEBAR_STORAGE_KEY = 'awardlens.sidebar.collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
}

export function AppShell({
  route,
  children,
}: {
  route: string;
  children: React.ReactNode;
}) {
  // Sidebar collapsed state lives here so the main column can react to it
  // (drop the max-width cap → the analytics canvas, pivot grid, and tree
  // visualization all expand into the freed real estate).
  const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsed);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    <div className="flex min-h-screen flex-col">
      <Topbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar
          currentRoute={route}
          collapsed={collapsed}
          onToggle={() => setCollapsed((v) => !v)}
        />
        <main className="flex flex-1 min-h-0 flex-col overflow-x-hidden">
          {/* Inner content column is a flex container so any page that
              opts in (Analytics) can have its tab panels grow to fill the
              full remaining viewport height. The min-h-0 on <main> is
              what lets that flex chain actually shrink — without it,
              flex-1 children would push past the viewport instead. */}
          {/* pt-8 keeps breathing room under the topbar; pb-0 lets a
              flex-1 child (e.g. Analytics' Tab card) reach the viewport
              edge. The old py-8 left ~32px of dead space below content
              that was already flex-1ing to fill. */}
          <div
            className={cn(
              'mx-auto flex h-full w-full flex-col px-6 pt-8 pb-0 transition-[max-width] duration-200 ease-out',
              collapsed ? 'max-w-none' : 'max-w-[1400px]',
            )}
          >
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
