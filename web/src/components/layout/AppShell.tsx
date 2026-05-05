import * as React from 'react';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';
import { cn } from '@/lib/utils';

const SIDEBAR_STORAGE_KEY = 'captureradar.sidebar.collapsed';

function readCollapsed(): boolean {
  if (typeof window === 'undefined') return false;
  return localStorage.getItem(SIDEBAR_STORAGE_KEY) === '1';
}

// Lets descendant pages programmatically collapse the sidebar (e.g. Analytics
// reclaims the left rail when the user switches between Tree / Summary /
// Pivot tabs). Returns a no-op when used outside the shell.
const SidebarCollapseContext = React.createContext<(collapsed: boolean) => void>(
  () => {},
);

export function useCollapseSidebar() {
  return React.useContext(SidebarCollapseContext);
}

/**
 * AppShell — top bar + sidebar + main content. Children come from
 * react-router's <Outlet/> so each route renders inside the same chrome.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const [collapsed, setCollapsed] = React.useState<boolean>(readCollapsed);

  React.useEffect(() => {
    if (typeof window === 'undefined') return;
    localStorage.setItem(SIDEBAR_STORAGE_KEY, collapsed ? '1' : '0');
  }, [collapsed]);

  return (
    // h-screen (not min-h-screen) locks the root to exactly the viewport
    // height so the inner flex chain can `flex-1` without the page growing
    // taller than viewport. <main> carries its own overflow-y-auto.
    <SidebarCollapseContext.Provider value={setCollapsed}>
      <div className="flex h-screen flex-col overflow-hidden">
        <Topbar />
        <div className="flex flex-1 min-h-0">
          <Sidebar
            collapsed={collapsed}
            onToggle={() => setCollapsed((v) => !v)}
          />
          <main className="flex flex-1 min-h-0 flex-col overflow-x-hidden overflow-y-auto">
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
    </SidebarCollapseContext.Provider>
  );
}
