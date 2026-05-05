/**
 * Route registry — canonical paths used by the sidebar, breadcrumbs, and
 * route definitions. Single source of truth so renames are atomic.
 *
 * Mirrors the spec sitemap §2 with the two exceptions called out in the
 * differentiation list:
 *   - one /settings (unified, not split /profile + /account)
 *   - SLED routes piggyback federal pages with `?scope=sled` rather than the
 *     parallel /sl/ tree (collapses 50+ duplicate routes; same UX)
 */
export const routes = {
  // Explore
  home:               '/',
  searchAll:          '/all',

  // Business Development — Opportunities
  contractOpps:       '/opportunity/contract',
  contractOpp:        '/opportunity/contract/:slug',
  grantOpps:          '/opportunity/grant',
  grantOpp:           '/opportunity/grant/:slug',
  forecasts:          '/opportunity/forecasts',
  dibbs:              '/opportunity/dibbs',

  // Pursuit Management
  pipelines:          '/pipeline',
  pipelineNew:        '/pipeline/new',
  pursuits:           '/pursuit',
  pursuit:            '/pursuit/:id',
  activities:         '/activity',

  // BD Tools
  partnerFinder:      '/partner-finder',
  governmentBuyers:   '/government-buyer',
  laborPricing:       '/labor-pricing',

  // Market Intelligence — Analysis
  marketAnalysis:     '/analysis',

  // Awards
  vehicles:           '/vehicle',
  vehicle:            '/vehicle/:slug',
  contractAwards:     '/award/contract',
  contractAwardIDV:   '/award/contract/idv/:id',
  contractAwardPrime: '/award/contract/prime/:id',
  contractAwardSub:   '/award/contract/sub/:id',
  grantAwards:        '/award/grant',
  grantAward:         '/award/grant/:id',

  // Awardees / Agencies / People
  awardees:           '/awardee',
  awardee:            '/awardee/:slug',
  agencies:           '/agency',
  agency:             '/agency/:slug',
  people:             '/people',
  person:             '/people/:slug',

  // Documents
  documents:          '/document',
  document:           '/document/:id',

  // Reference
  defensePrograms:    '/defense-program',
  defenseProgram:     '/defense-program/:slug',
  itPrograms:         '/it-program',
  itProgram:          '/it-program/:slug',
  cfda:               '/assistance',
  cfdaProgram:        '/assistance/:slug',
  sewp:               '/product-pricing',
  naics:              '/naics',
  naicsCode:          '/naics/:code',
  nia:                '/nia',
  niaCode:            '/nia/:slug',
  nsn:                '/nsn',
  nsnItem:            '/nsn/:nsn',
  psc:                '/psc',
  pscCode:            '/psc/:code',
  budget:             '/budget',
  budgetItem:         '/budget/:slug',
  protests:           '/protest',
  protest:            '/protest/:slug',

  // Capital Markets (Leader-tier paywall)
  transactions:       '/transaction',
  transaction:        '/transaction/:id',
  investors:          '/investor',
  investor:           '/investor/:slug',
  advisors:           '/advisor',
  advisor:            '/advisor/:slug',

  // Tools
  favorites:          '/favorites',
  savedSearches:      '/search',
  proposals:          '/proposal',
  proposal:           '/proposal/:id',
  foia:               '/foia',
  news:               '/news',
  newsArticle:        '/news/:slug',
  downloads:          '/downloads',

  // Settings (unified — DIFFERENTIATION from HigherGov's split /profile+/account)
  settings:           '/settings',
  settingsTab:        '/settings/:tab',

  // Pricing
  pricing:            '/pricing',

  // Legacy / admin (Phase 0 holdovers — stay on D1 worker until cutover)
  legacyAnalytics:    '/legacy/analytics',
  quality:            '/quality',
  schedule:           '/schedule',
  runs:               '/runs',
  adminUsers:         '/admin/users',
  adminAccess:        '/admin/access-requests',

  // Auth states
  pending:            '/pending',
  rejected:           '/rejected',
} as const;

export type RouteKey = keyof typeof routes;
