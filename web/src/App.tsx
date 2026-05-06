import { BrowserRouter, Route, Routes, Navigate } from 'react-router-dom';
import { QueryClientProvider } from '@tanstack/react-query';
import { Toaster } from 'sonner';
import { AnimatePresence, motion } from 'framer-motion';
import { AuthProvider, useAuth } from '@/lib/auth-context';
import { AgencyProvider } from '@/lib/agency-context';
// ViewProvider is retained for the legacy /legacy/analytics page until that
// page is rebuilt as the new Dashboard. The /views, /admin/views, and
// /admin/access-requests routes are sunset (spec direction).
import { ViewProvider } from '@/lib/view-context';
import { AppShell } from '@/components/layout/AppShell';
import { SignInPage } from '@/pages/SignIn';
import { PendingPage } from '@/pages/Pending';
import { RejectedPage } from '@/pages/Rejected';
import { AnalyticsPage } from '@/pages/Analytics';
import { DashboardHomePage } from '@/pages/DashboardHome';
import { ContractOpportunitiesListPage } from '@/pages/opportunities/ContractOpportunitiesList';
import { ContractOpportunityDetailPage } from '@/pages/opportunities/ContractOpportunityDetail';
import { AwardeesListPage } from '@/pages/awardees/AwardeesList';
import { AwardeeDetailPage } from '@/pages/awardees/AwardeeDetail';
import { MarketAnalysisPage } from '@/pages/MarketAnalysis';
import { SettingsPage } from '@/pages/Settings';
import { QualityPage } from '@/pages/Quality';
import { SchedulePage } from '@/pages/Schedule';
import { RunsPage } from '@/pages/Runs';
import { AdminUsersPage } from '@/pages/AdminUsers';
import { Logo } from '@/components/ui/Logo';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { PipelinePage } from '@/pages/Pipeline';
import { StubPage } from '@/pages/StubPage';
import { ConversationalIntelligenceWidget } from '@/components/ConversationalIntelligenceWidget';
import { AwardDetail } from '@/components/AwardDetail';
import {
  AiAwardProvider, useSelectedAward, useSetSelectedAward,
} from '@/lib/ai-award-context';
import { queryClient } from '@/lib/query-client';
import { routes } from '@/lib/routes';

export default function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <BrowserRouter>
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
      </BrowserRouter>
    </QueryClientProvider>
  );
}

function RootRouter() {
  const { status } = useAuth();

  if (status === 'loading')        return <BootSplash />;
  if (status === 'unauthenticated') return <SignInPage />;
  if (status === 'pending')         return <PendingPage />;
  if (status === 'rejected')        return <RejectedPage />;

  return (
    <>
      <AppShell>
        <AnimatedRoute>
          <ErrorBoundary label="Page error">
            <AppRoutes />
          </ErrorBoundary>
        </AnimatedRoute>
      </AppShell>
      <ConversationalIntelligenceWidget />
      <GlobalAwardDetail />
    </>
  );
}

// Per-route fade transition wrapper.
function AnimatedRoute({ children }: { children: React.ReactNode }) {
  return (
    <AnimatePresence mode="wait">
      <motion.div
        initial={{ opacity: 0, y: 6 }}
        animate={{ opacity: 1, y: 0 }}
        exit={{ opacity: 0, y: -4 }}
        transition={{ duration: 0.22 }}
      >
        {children}
      </motion.div>
    </AnimatePresence>
  );
}

// AwardDetail rendered at the App level (not inside AnalyticsPage) so it
// stays mounted across route changes and so the chat widget — which lives
// outside the route tree — can open it via the shared context.
function GlobalAwardDetail() {
  const award = useSelectedAward();
  const setSelected = useSetSelectedAward();
  return <AwardDetail award={award} onClose={() => setSelected(null)} />;
}

function AppRoutes() {
  const { user } = useAuth();
  const isAdmin = user?.role === 'admin';

  return (
    <Routes>
      {/* ── Explore ───────────────────────────────────────────────────── */}
      <Route path={routes.home}      element={<DashboardHomePage />} />
      <Route path={routes.searchAll} element={<StubPage title="Search All Federal" eyebrow="Explore" />} />

      {/* ── Business Development — Opportunities ─────────────────────── */}
      <Route path={routes.contractOpps} element={<ContractOpportunitiesListPage />} />
      <Route path={routes.contractOpp}  element={<ContractOpportunityDetailPage />} />
      <Route path={routes.grantOpps}    element={<StubPage title="Federal Grant Opportunities" eyebrow="Business Development" />} />
      <Route path={routes.grantOpp}     element={<StubPage title="Grant Opportunity" eyebrow="Detail" />} />
      <Route path={routes.forecasts}    element={<StubPage title="Forecasts" eyebrow="Business Development" />} />
      <Route path={routes.dibbs}        element={<StubPage title="DIBBS Opportunities" eyebrow="Business Development" />} />

      {/* ── Pursuit Management ───────────────────────────────────────── */}
      <Route path={routes.pipelines}    element={<PipelinePage />} />
      <Route path={routes.pipelineNew}  element={<StubPage title="New pipeline" eyebrow="Pipeline" />} />
      <Route path={routes.pursuits}     element={<StubPage title="Pursuits" eyebrow="Business Development" />} />
      <Route path={routes.pursuit}      element={<StubPage title="Pursuit" eyebrow="Detail" />} />
      <Route path={routes.activities}   element={<StubPage title="Activities" eyebrow="Business Development" />} />

      {/* ── BD Tools ─────────────────────────────────────────────────── */}
      <Route path={routes.partnerFinder}   element={<StubPage title="Partner Finder" eyebrow="Business Development" />} />
      <Route path={routes.governmentBuyers}element={<StubPage title="Government Buyers" eyebrow="Business Development" />} />
      <Route path={routes.laborPricing}    element={<StubPage title="Labor Pricing" eyebrow="Business Development" />} />

      {/* ── Market Intelligence ──────────────────────────────────────── */}
      <Route path={routes.marketAnalysis}      element={<MarketAnalysisPage />} />
      <Route path={routes.vehicles}            element={<StubPage title="Contract Vehicles" eyebrow="Market Intelligence" />} />
      <Route path={routes.vehicle}             element={<StubPage title="Vehicle" eyebrow="Detail" />} />
      <Route path={routes.contractAwards}      element={<StubPage title="Federal Contract Awards" eyebrow="Market Intelligence" />} />
      <Route path={routes.contractAwardIDV}    element={<StubPage title="IDV Award" eyebrow="Detail" />} />
      <Route path={routes.contractAwardPrime}  element={<StubPage title="Prime Contract" eyebrow="Detail" />} />
      <Route path={routes.contractAwardSub}    element={<StubPage title="Subcontract" eyebrow="Detail" />} />
      <Route path={routes.grantAwards}         element={<StubPage title="Federal Grant Awards" eyebrow="Market Intelligence" />} />
      <Route path={routes.grantAward}          element={<StubPage title="Grant Award" eyebrow="Detail" />} />

      {/* ── Awardees / Agencies / People ────────────────────────────── */}
      <Route path={routes.awardees} element={<AwardeesListPage />} />
      <Route path={routes.awardee}  element={<AwardeeDetailPage />} />
      <Route path={routes.agencies} element={<StubPage title="Federal Agencies" eyebrow="Market Intelligence" />} />
      <Route path={routes.agency}   element={<StubPage title="Agency" eyebrow="Detail" />} />
      <Route path={routes.people}   element={<StubPage title="Federal People" eyebrow="Market Intelligence" />} />
      <Route path={routes.person}   element={<StubPage title="Person" eyebrow="Detail" />} />

      {/* ── Documents ────────────────────────────────────────────────── */}
      <Route path={routes.documents} element={<StubPage title="Federal Documents" eyebrow="Market Intelligence" />} />
      <Route path={routes.document}  element={<StubPage title="Document" eyebrow="Detail" />} />

      {/* ── Reference ────────────────────────────────────────────────── */}
      <Route path={routes.defensePrograms} element={<StubPage title="Defense Programs" eyebrow="Reference" />} />
      <Route path={routes.defenseProgram}  element={<StubPage title="Defense Program" eyebrow="Detail" />} />
      <Route path={routes.itPrograms}      element={<StubPage title="IT Programs" eyebrow="Reference" />} />
      <Route path={routes.itProgram}       element={<StubPage title="IT Program" eyebrow="Detail" />} />
      <Route path={routes.cfda}            element={<StubPage title="Grant Programs (CFDA)" eyebrow="Reference" />} />
      <Route path={routes.cfdaProgram}     element={<StubPage title="CFDA Program" eyebrow="Detail" />} />
      <Route path={routes.sewp}            element={<StubPage title="SEWP Catalog" eyebrow="Reference" />} />
      <Route path={routes.naics}           element={<StubPage title="NAICS Codes" eyebrow="Reference" />} />
      <Route path={routes.naicsCode}       element={<StubPage title="NAICS Code" eyebrow="Detail" />} />
      <Route path={routes.nia}             element={<StubPage title="National Interest Actions" eyebrow="Reference" />} />
      <Route path={routes.niaCode}         element={<StubPage title="NIA" eyebrow="Detail" />} />
      <Route path={routes.nsn}             element={<StubPage title="NSN" eyebrow="Reference" />} />
      <Route path={routes.nsnItem}         element={<StubPage title="NSN" eyebrow="Detail" />} />
      <Route path={routes.psc}             element={<StubPage title="PSC Codes" eyebrow="Reference" />} />
      <Route path={routes.pscCode}         element={<StubPage title="PSC Code" eyebrow="Detail" />} />
      <Route path={routes.budget}          element={<StubPage title="DoD Budget" eyebrow="Reference" />} />
      <Route path={routes.budgetItem}      element={<StubPage title="Budget Line Item" eyebrow="Detail" />} />
      <Route path={routes.protests}        element={<StubPage title="Federal Protests" eyebrow="Reference" />} />
      <Route path={routes.protest}         element={<StubPage title="Protest" eyebrow="Detail" />} />

      {/* ── Capital Markets (Leader-tier paywall handled inside the page) ── */}
      <Route path={routes.transactions} element={<StubPage title="M&A Transactions" eyebrow="Capital Markets" />} />
      <Route path={routes.transaction}  element={<StubPage title="Transaction" eyebrow="Detail" />} />
      <Route path={routes.investors}    element={<StubPage title="Investors"        eyebrow="Capital Markets" />} />
      <Route path={routes.investor}     element={<StubPage title="Investor"         eyebrow="Detail" />} />
      <Route path={routes.advisors}     element={<StubPage title="M&A Advisors"     eyebrow="Capital Markets" />} />
      <Route path={routes.advisor}      element={<StubPage title="Advisor"          eyebrow="Detail" />} />

      {/* ── Tools ────────────────────────────────────────────────────── */}
      <Route path={routes.favorites}     element={<StubPage title="Favorites"      eyebrow="Tools" />} />
      <Route path={routes.savedSearches} element={<StubPage title="Saved Searches" eyebrow="Tools" />} />
      <Route path={routes.proposals}     element={<StubPage title="Proposals"      eyebrow="Tools" />} />
      <Route path={routes.proposal}      element={<StubPage title="Proposal"       eyebrow="Detail" />} />
      <Route path={routes.foia}          element={<StubPage title="FOIA Requests"  eyebrow="Tools" />} />
      <Route path={routes.news}          element={<StubPage title="News"           eyebrow="Tools" />} />
      <Route path={routes.newsArticle}   element={<StubPage title="Article"        eyebrow="Detail" />} />
      <Route path={routes.downloads}     element={<StubPage title="Downloads"      eyebrow="Tools" />} />

      {/* ── Settings (unified — DIFFERENTIATION) ────────────────────── */}
      <Route path={routes.settings}    element={<SettingsPage />} />
      <Route path={routes.settingsTab} element={<SettingsPage />} />

      {/* ── Pricing ──────────────────────────────────────────────────── */}
      <Route path={routes.pricing} element={<StubPage title="Pricing" eyebrow="Plans" />} />

      {/* ── Legacy admin (D1-backed, holdover from Phase 0) ────────── */}
      <Route path={routes.legacyAnalytics} element={<AnalyticsPage />} />
      <Route path={routes.quality}     element={isAdmin ? <QualityPage />    : <Navigate to={routes.home} />} />
      <Route path={routes.schedule}    element={isAdmin ? <SchedulePage />   : <Navigate to={routes.home} />} />
      <Route path={routes.runs}        element={isAdmin ? <RunsPage />       : <Navigate to={routes.home} />} />
      <Route path={routes.adminUsers}  element={isAdmin ? <AdminUsersPage /> : <Navigate to={routes.home} />} />
      <Route path={routes.adminAccess} element={isAdmin ? <StubPage title="Access Requests" eyebrow="Admin" /> : <Navigate to={routes.home} />} />

      {/* Catch-all */}
      <Route path="*" element={<StubPage title="Not found" eyebrow="404" />} />
    </Routes>
  );
}

function BootSplash() {
  return (
    <div className="grid min-h-screen place-items-center">
      <div className="flex flex-col items-center gap-4">
        <Logo size={56} withGlow className="animate-[fade-in_0.6s_ease-out]" />
        <div className="text-[10px] font-bold uppercase tracking-[0.18em] text-muted-soft">
          Loading session…
        </div>
      </div>
    </div>
  );
}
