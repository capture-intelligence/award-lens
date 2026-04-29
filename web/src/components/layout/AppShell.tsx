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
        <main className="flex-1 overflow-x-hidden">
          <div
            className={cn(
              'mx-auto px-6 py-8 transition-[max-width] duration-200 ease-out',
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
