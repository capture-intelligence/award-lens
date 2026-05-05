import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { ViewProvider } from '@/lib/view-context';
import { AgencyProvider } from '@/lib/agency-context';
import { useHashRoute } from '@/lib/router';
import { AppShell } from '@/components/layout/AppShell';
import { SignInPage } from '@/pages/SignIn';
import { PendingPage } from '@/pages/Pending';
import { RejectedPage } from '@/pages/Rejected';
import { AnalyticsPage } from '@/pages/Analytics';
import { QualityPage } from '@/pages/Quality';
import { SchedulePage } from '@/pages/Schedule';
import { RunsPage } from '@/pages/Runs';
import { Logo } from '@/components/ui/Logo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { AdminUsersPage } from '@/pages/AdminUsers';
import { AdminViewsPage } from '@/pages/AdminViews';
import { AdminAccessRequestsPage } from '@/pages/AdminAccessRequests';
import { BrowseViewsPage } from '@/pages/BrowseViews';
import { PipelinePage } from '@/pages/Pipeline';
import { PlaceholderPage } from '@/pages/Placeholder';
import { ConversationalIntelligenceWidget } from '@/components/ConversationalIntelligenceWidget';
import { AwardDetail } from '@/components/AwardDetail';
import { AiAwardProvider, useSelectedAward, useSetSelectedAward } from '@/lib/ai-award-context';

export default function App() {
  return (
    <AuthProvider>
      <AiAwardProvider>
      <ViewProvider>
      <AgencyProvider>
      <Toaster
        theme="dark"
        position="top-right"
        toastOptions={{
          style: {
            background: 'rgba(26,52,61,0.92)',
            border: '1px solid rgba(255,255,255,0.08)',
            color: '#FBE9D0',
            backdropFilter: 'blur(12px)',
          },
        }}
      />
      <RootRouter />
      </AgencyProvider>
      </ViewProvider>
      </AiAwardProvider>
    </AuthProvider>
  );
}

function RootRouter() {
  const { status } = useAuth();
  const route = useHashRoute();

  if (status === 'loading') return <BootSplash />;
  if (status === 'unauthenticated') return <SignInPage />;
  if (status === 'pending')        return <PendingPage />;
  if (status === 'rejected')       return <RejectedPage />;

  return (
    <>
      <AppShell route={route}>
        <AnimatePresence mode="wait">
          <motion.div
            key={route}
            initial={{ opacity: 0, y: 6 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: -4 }}
            transition={{ duration: 0.22 }}
          >
            <ErrorBoundary label="Page error">
              <RouteView route={route} />
            </ErrorBoundary>
          </motion.div>
        </AnimatePresence>
      </AppShell>
      <ConversationalIntelligenceWidget />
      <GlobalAwardDetail />
    </>
  );
}

// AwardDetail rendered at the App level (not inside AnalyticsPage) so it
// stays mounted across route changes and so the chat widget — which lives
// outside the route tree — can open it via the shared context.
function GlobalAwardDetail() {
  const award      = useSelectedAward();
  const setSelected = useSetSelectedAward();
  return <AwardDetail award={award} onClose={() => setSelected(null)} />;
}

function RouteView({ route }: { route: string }) {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  // Default landing → Analytics. Users pick a view from the topbar, then
  // explore everything in one consolidated table.
  if (route === '/' || route === '')                  return <AnalyticsPage />;
  if (route === '/pipeline')                          return <PipelinePage />;
  if (route === '/views')                             return <BrowseViewsPage />;
  // Operate-section pages are admin-only — non-admins fall through to 404
  // if they hit the URL directly.
  if (route === '/quality'  && isAdmin)               return <QualityPage />;
  if (route === '/schedule' && isAdmin)               return <SchedulePage />;
  if (route === '/runs'     && isAdmin)               return <RunsPage />;
  if (route === '/admin/users' && isAdmin)            return <AdminUsersPage />;
  if (route === '/admin/views' && isAdmin)            return <AdminViewsPage />;
  if (route === '/admin/access-requests' && isAdmin)  return <AdminAccessRequestsPage />;

  return <PlaceholderPage title="Not found" eyebrow="404" />;
}

function BootSplash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Logo
          size={56}
          withGlow
          className="animate-[fade-in_0.6s_ease-out]"
        />
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-soft">
          Loading session…
        </div>
      </div>
    </div>
  );
}
