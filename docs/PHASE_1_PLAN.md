# CaptureRadar — Phase 1 Plan

Phase 0 stood up the schema, API, queues, and routing. Phase 1 fills the UI with real data and ships the demo-ready user experience. Estimated calendar time: ~3-5 weeks of focused work.

## What ships in Phase 1

| Area | Deliverable |
|---|---|
| **Auth** | Multi-user invites; org-scoped users; admin/member/viewer RBAC enforced in API. |
| **Sidebar** | Already restructured to spec sections (✓). |
| **Shared components** | All 12 already built (✓). |
| **Pages** | Replace each `<StubPage/>` with the real implementation, in priority order below. |
| **Ingestion** | Live SAM, USAspending, Grants.gov; CFDA + IT Dashboard. Seeds for everything else. |
| **AI (pre-computed)** | Description summaries, value estimates, embeddings via Workers AI; profile vectors for match scoring. |
| **Saved searches + email alerts** | Resend channel only in Phase 1; Slack/Teams/SMS land in Phase 3. |
| **Favorites** | Cross-entity. |
| **Pricing page** | Public, 3-tier comparison. |

## Page priority order

1. **Dashboard home (/)** — recommendations, calendar, activities, news
2. **Federal Contract Opportunities** — list + 15-tab detail
3. **Federal Contract Awards** — IDV / Prime / Sub tabs + detail
4. **Federal Awardees** — list + 17-tab detail
5. **Federal Agencies** — list + 11-tab detail
6. **Market Analysis (/analysis)** — full BI dashboard via FederalAwardAnalysisChart
7. **Saved Searches & Alerts** — email channel only
8. **Favorites**
9. **Pricing**
10. **Settings** — unified single page (DIFFERENTIATION)

Phase 2 picks up: Grant Opportunities, Vehicles, People, Documents+PDF viewer+Document Assistant, Pursuit Management (kanban+funnel), Labor Pricing, Partner Finder, Government Buyers, all reference data, Protests, News, Proposals, FOIA, Downloads, API Key Management.

## Demo dataset target (the $0 plan)

Real ingestion (free public APIs):

| Entity | Source | Window | Volume |
|---|---|---|---|
| Contract Opportunities | SAM.gov | last 6 mo active | ~80K |
| Grant Opportunities | Grants.gov | last 12 mo | ~10K |
| Contract Awards (Prime) | USAspending | FY25, ≥$100K | ~500K |
| IDV / Sub | USAspending derive | same | ~50K / ~100K |
| Grant Awards | USAspending | FY25 | ~200K |
| Awardees | derived from awards | — | ~80K real |
| Agencies | full | — | 3K |
| NAICS / PSC / CFDA / NIA / IT Programs | full reference APIs | — | all |
| Documents | demo opp attachments | — | ~5K (~8GB R2) |
| News | RSS (DefenseNews, NextGov, FedScoop, Federal News Network) | last 60 days | ~2K |

Seeded (skipped scrapers, look real):

| Entity | Volume |
|---|---|
| DIBBS, SLED opps | ~5K |
| GAO protests | ~200 |
| FAA labor + GSA labor (real CSV) | ~20K |
| NSN catalog | ~10K |
| SEWP catalog | ~5K |
| Defense programs | full 242 (semi-real, public) |
| DoD budget | ~6.5K (PB JBs, public) |
| M&A transactions | ~50 (real recent public deals) |
| Investors | ~30 known GovCon PE firms |
| Advisors | ~15 known M&A advisors |

**Postgres footprint:** ~3-5 GB. Way under the 200 GB VM disk.

## AI plan (Workers AI free tier)

| Feature | Model | When |
|---|---|---|
| Description summary | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | On ingest, batch |
| Value-range estimate | same | On ingest, batch |
| Pricing-type prediction | same (constrained output) | On ingest, batch |
| Description embedding | `@cf/baai/bge-base-en-v1.5` (768-dim) | On ingest, batch |
| User profile embedding | bge-base | On profile change |
| Match score | cosine vs profile_embedding (no AI call) | At query time |
| Similar opps | cosine vs description_embedding (no AI call) | At query time |
| Opportunity Assistant | streaming Llama 3.3 | On chat send |
| Document Assistant | streaming Llama 3.3 over extracted text | On chat send |

**Daily-budget cap:** `WORKERS_AI_DAILY_BUDGET=8000` hard-stops at 80% of free quota.

**Quality fallback:** All generative outputs marked with the ✦ AI badge so users see they're "Preview." When you fund Anthropic, flip `ANTHROPIC_API_KEY` and the generative path swaps with one client-class change — no UI rework.

## Build order (per page)

For each page, work in this order so we never block on missing pieces:

1. API endpoint already exists from Phase 0 (`/v1/<entity>` stub returns empty list). Replace the stub with real query (filter args, cursor pagination).
2. TanStack Query hook in `web/src/lib/queries/<entity>.ts`.
3. Replace `<StubPage/>` route in `App.tsx` with the real component.
4. List view: DataTable + FilterPanel + ExportDropdown + SaveSearchModal.
5. Detail view: EntityDetailLayout with all spec tabs (some lazy-loaded).
6. Wire AI features: AISummaryToggle on description, AI badges on AI fields, AIAssistantChat for entity assistants.

## Acceptance criteria for "Phase 1 done"

- [ ] All Phase 1 pages from priority list above render real data.
- [ ] First page paint <2s on `/contract-opportunity/`, `/awardee/`, `/agency/` (cursor pagination).
- [ ] Saved searches with email frequency persist + deliver one demo email per day.
- [ ] Favorites work cross-entity.
- [ ] Market Analysis dashboard renders Trends/Shares/Categories/VehicleRankings/AwardeeRankings sub-tabs.
- [ ] Mobile responsive: all Phase 1 pages render at 375px width.
- [ ] $0/mo costs maintained (no Anthropic, no paid email tier, no managed Postgres).
- [ ] Demo can be navigated cold by an investor without seeing a `StubPage` — every Phase 1 path has real content.

## What this enables

After Phase 1, you have a credible HigherGov competitor demo: searchable opportunities + awards + awardees + agencies, saved searches with email alerts, AI-summarized descriptions, market analysis dashboard, the new brand and unified settings UX. Investors and customers can click through every Phase 1 surface and see something real. Phase 2 fills the rest of the spec; Phase 3 is the differentiation push (Slack/Teams, mobile-first, semantic search, win-prob scoring, proposal collaboration, role-based access, native CRM integration).
