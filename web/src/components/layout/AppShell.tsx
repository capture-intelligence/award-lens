import * as React from 'react';
import { Topbar } from './Topbar';
import { Sidebar } from './Sidebar';

export function AppShell({
  route,
  children,
}: {
  route: string;
  children: React.ReactNode;
}) {
  return (
    <div className="flex min-h-screen flex-col">
      <Topbar />
      <div className="flex flex-1 min-h-0">
        <Sidebar currentRoute={route} />
        <main className="flex-1 overflow-x-hidden">
          <div className="mx-auto max-w-[1400px] px-6 py-8">{children}</div>
        </main>
      </div>
    </div>
  );
}
