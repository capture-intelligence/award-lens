import * as React from 'react';
import { PageHeader } from '@/components/ui/PageHeader';
import { FederalAwardAnalysisChart } from '@/components/ui/FederalAwardAnalysisChart';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { toast } from 'sonner';

/**
 * Market Analysis (spec §3.7) — the same chart suite that embeds on every
 * entity detail page, but rendered here standalone with no entity filter.
 *
 * The audit observed this page hitting $21.6T total spending across all
 * award types over a 10-year window. Phase 0 ships with mock aggregate
 * data so the chart renders today; Phase 1 wires it to ClickHouse-style
 * aggregations on Postgres (or rolls forward to ClickHouse if perf demands).
 */
export function MarketAnalysisPage() {
  const [type, setType] = React.useState<'all'|'contracts'|'grants'>('all');
  const [years, setYears] = React.useState<3|5|10>(10);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Market Analysis"
        description="Federal spending across contracts, subcontracts, grants, and subgrants — sliced by year, agency, NAICS, PSC, vehicle, set-aside, and place of performance."
        actions={
          <ExportDropdown totalCount={1} tierLimit={20_000} onExport={() => toast.success('Chart export queued')} />
        }
      />
      <FederalAwardAnalysisChart
        kpis={KPIS}
        trendData={TRENDS}
        vehicleRankings={VEHICLES}
        awardeeRankings={AWARDEES}
        type={type}
        onTypeChange={setType}
        years={years}
        onYearsChange={setYears}
        onExport={() => toast.success('Chart export queued')}
      />
    </div>
  );
}

const KPIS = {
  contracts:    6_700_000_000_000,
  subcontracts: 1_200_000_000_000,
  grants:      11_300_000_000_000,
  subgrants:    2_500_000_000_000,
};

const TRENDS = Array.from({ length: 10 }, (_, i) => {
  const year = 2016 + i;
  const growth = 1 + i * 0.04;
  return {
    year,
    contracts:     Math.round(530_000_000_000 * growth),
    subcontracts:  Math.round( 96_000_000_000 * growth),
    grants:        Math.round(900_000_000_000 * growth),
    subgrants:     Math.round(200_000_000_000 * growth),
  };
});

const VEHICLES = [
  { rank: 1, name: 'GSA MAS',       obligations: 124_100_000_000, pct: 18.3 },
  { rank: 2, name: 'SEWP V',        obligations:  35_300_000_000, pct: 5.2 },
  { rank: 3, name: 'Alliant II',    obligations:  32_300_000_000, pct: 4.8 },
  { rank: 4, name: 'OASIS',         obligations:  24_500_000_000, pct: 3.6 },
  { rank: 5, name: 'Seaport-NXG',   obligations:  23_800_000_000, pct: 3.5 },
];

const AWARDEES = [
  { rank: 1, name: 'State of California',     obligations: 132_500_000_000 },
  { rank: 2, name: 'Lockheed Martin Corp.',   obligations:  75_400_000_000 },
  { rank: 3, name: 'State of New York',       obligations:  64_500_000_000 },
  { rank: 4, name: 'State of Texas',          obligations:  40_300_000_000 },
  { rank: 5, name: 'RTX Corporation',         obligations:  35_200_000_000 },
];
