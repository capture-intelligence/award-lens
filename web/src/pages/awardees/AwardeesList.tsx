import * as React from 'react';
import { Link } from 'react-router-dom';
import { type ColumnDef } from '@tanstack/react-table';
import { Building2 } from 'lucide-react';
import { PageHeader } from '@/components/ui/PageHeader';
import { DataTable } from '@/components/ui/DataTable';
import { FilterPanel, type FilterState } from '@/components/ui/FilterPanel';
import { ExportDropdown } from '@/components/ui/ExportDropdown';
import { fmtMoney } from '@/lib/utils';
import { toast } from 'sonner';

interface AwardeeRow {
  awardee_id: string;
  slug: string;
  legal_name: string;
  uei: string;
  cage: string;
  hq_country: string;
  hq_state: string;
  hq_city: string;
  founded: number | null;
  total_py_awards: number;
}

export function AwardeesListPage() {
  const [filters, setFilters] = React.useState<FilterState>({ quick: {}, search: {} });

  const columns = React.useMemo<ColumnDef<AwardeeRow, unknown>[]>(() => [
    {
      accessorKey: 'legal_name',
      header: 'Name',
      cell: ({ row }) => (
        <Link to={`/awardee/${row.original.slug}`} className="flex items-center gap-2 font-medium text-foreground hover:text-brand-vermilion-soft hover:underline">
          <span className="grid h-7 w-7 place-items-center rounded-md bg-brand-teal-soft/30 text-muted-soft">
            <Building2 className="h-3.5 w-3.5" />
          </span>
          {row.original.legal_name}
        </Link>
      ),
      meta: { minWidth: 280 },
    },
    { accessorKey: 'uei',  header: 'UEI',         cell: ({ row }) => <span className="text-muted tabular-nums">{row.original.uei}</span>, meta: { minWidth: 120 } },
    { accessorKey: 'cage', header: 'CAGE',        cell: ({ row }) => <span className="text-muted tabular-nums">{row.original.cage}</span> },
    { accessorKey: 'hq_country', header: 'Country', cell: ({ row }) => row.original.hq_country },
    { accessorKey: 'hq_state',   header: 'State',   cell: ({ row }) => row.original.hq_state },
    { accessorKey: 'hq_city',    header: 'City',    cell: ({ row }) => row.original.hq_city },
    { accessorKey: 'founded',    header: 'Founded', cell: ({ row }) => row.original.founded ?? '—', meta: { numeric: true } },
    { accessorKey: 'total_py_awards', header: 'PY Awards', cell: ({ row }) => fmtMoney(row.original.total_py_awards), meta: { numeric: true, minWidth: 120 } },
  ], []);

  return (
    <div className="flex flex-col gap-6 pb-12">
      <PageHeader
        eyebrow="Market Intelligence"
        title="Federal Awardees"
        description="2.2M federal contractors and grantees with registration, certifications, and award history."
        actions={
          <ExportDropdown totalCount={2_200_000} tierLimit={20_000} onExport={() => toast.success('Export queued')} />
        }
      />

      <div className="flex items-center gap-2">
        <span className="rounded-full border border-brand-vermilion/40 bg-brand-vermilion/10 px-3 py-1 text-[11px] font-bold uppercase tracking-wider text-brand-vermilion-soft">
          2.2M results
        </span>
      </div>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-[320px_1fr]">
        <FilterPanel
          quickFilters={[
            { id: 'small_business',label: 'Small business' },
            { id: 'wosb',          label: 'WOSB' },
            { id: 'sdvosb',        label: 'SDVOSB' },
            { id: 'hubzone',       label: 'HUBZone' },
            { id: '8a',            label: '8(a) certified' },
            { id: 'my_favorites',  label: 'My favorites' },
          ]}
          searchFilters={[
            { id: 'q',         label: 'Keywords',   type: 'text' },
            { id: 'state',     label: 'State',      type: 'multi-select', options: STATE_OPTS },
            { id: 'naics',     label: 'Primary NAICS', type: 'multi-select', options: NAICS_OPTS },
            { id: 'founded',   label: 'Founded',    type: 'number-range' },
            { id: 'py_awards', label: 'PY awards',  type: 'number-range', format: 'currency' },
          ]}
          value={filters}
          onChange={setFilters}
          onReset={() => setFilters({ quick: {}, search: {} })}
        />
        <DataTable<AwardeeRow>
          columns={columns}
          data={MOCK_AWARDEES}
          totalCount={2_200_000}
          ariaLabel="Federal awardees"
          columnVisibilityStorageKey="captureradar.awardees.cols"
        />
      </div>
    </div>
  );
}

const MOCK_AWARDEES: AwardeeRow[] = [
  { awardee_id: 'a1', slug: 'lockheed-martin-corporation', legal_name: 'Lockheed Martin Corporation',  uei: 'KKLPLNS6KCG3', cage: '0HSY7', hq_country: 'USA', hq_state: 'MD', hq_city: 'Bethesda', founded: 1995, total_py_awards: 75_400_000_000 },
  { awardee_id: 'a2', slug: 'rtx-corporation',             legal_name: 'RTX Corporation',              uei: 'TX5YQNXP1AS6', cage: '7B519', hq_country: 'USA', hq_state: 'VA', hq_city: 'Arlington',founded: 2020, total_py_awards: 35_200_000_000 },
  { awardee_id: 'a3', slug: 'booz-allen-hamilton',         legal_name: 'Booz Allen Hamilton',          uei: 'M9XVLA2H2KE5', cage: '2A267', hq_country: 'USA', hq_state: 'VA', hq_city: 'McLean',   founded: 1914, total_py_awards: 14_300_000_000 },
  { awardee_id: 'a4', slug: 'leidos-inc',                  legal_name: 'Leidos, Inc.',                 uei: 'LEMUL2N3RAZ5', cage: '3F724', hq_country: 'USA', hq_state: 'VA', hq_city: 'Reston',   founded: 1969, total_py_awards: 12_100_000_000 },
  { awardee_id: 'a5', slug: 'general-dynamics-it',         legal_name: 'General Dynamics IT',          uei: 'YS5QDR8V77V1', cage: '7CHQ1', hq_country: 'USA', hq_state: 'VA', hq_city: 'Falls Church', founded: 1952, total_py_awards: 11_800_000_000 },
  { awardee_id: 'a6', slug: 'saic-inc',                    legal_name: 'Science Applications Intl Corp', uei: 'KGJK1ZQTNHA7', cage: '0XB48', hq_country: 'USA', hq_state: 'VA', hq_city: 'Reston', founded: 1969, total_py_awards: 7_800_000_000 },
  { awardee_id: 'a7', slug: 'cgi-federal',                 legal_name: 'CGI Federal',                  uei: 'JU56N3V11EM7', cage: '06B85', hq_country: 'USA', hq_state: 'VA', hq_city: 'Fairfax',  founded: 1976, total_py_awards: 5_400_000_000 },
  { awardee_id: 'a8', slug: 'deloitte-consulting',         legal_name: 'Deloitte Consulting',          uei: 'DC5KH1A2N1XX', cage: '5D8E9', hq_country: 'USA', hq_state: 'NY', hq_city: 'New York', founded: 1995, total_py_awards: 9_700_000_000 },
];

const STATE_OPTS = ['VA','MD','DC','CA','TX','NY','FL','MA','GA','CO'].map((s) => ({ value: s, label: s }));
const NAICS_OPTS = [
  { value: '541512', label: '541512 — Computer Systems Design' },
  { value: '541330', label: '541330 — Engineering Services' },
  { value: '336411', label: '336411 — Aircraft Manufacturing' },
];
