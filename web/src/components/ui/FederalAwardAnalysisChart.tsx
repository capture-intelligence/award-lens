import * as React from 'react';
import {
  BarChart, Bar, AreaChart, Area, XAxis, YAxis,
  Tooltip, Legend, ResponsiveContainer, CartesianGrid,
} from 'recharts';
import { cn } from '@/lib/utils';
import { fmtMoney } from '@/lib/utils';

/**
 * FederalAwardAnalysisChart (#4 in spec shared components) — reusable BI
 * chart suite with sub-tabs: Trends (stacked bar/line), Shares (stacked
 * area), Categories (100% stacked), Maps (Leaflet choropleth, deferred to
 * Phase 1.5 to avoid SSR import cost), Vehicle Rankings (table), Awardee
 * Rankings (table); global Type + Years + Export controls; KPI cards:
 * Contracts $, Subcontracts $, Grants $, Subgrants $, Total $.
 *
 * This is the same chart suite the audit observed embedded on:
 *   /analysis/award/, every /awardee/{slug}/ Tab 2, every /agency/{slug}/
 *   Tab 2, every /vehicle/{slug}/ Tab 6, every /naics/{code}/ analysis tab,
 *   every /psc/{code}/, every /defense-program/{slug}/, every /nia/{slug}/.
 *
 * Phase 1 ships Trends / Shares / Categories / Vehicle Rankings / Awardee
 * Rankings; Maps lands when Leaflet bundles correctly.
 */

export type AnalysisType = 'all' | 'contracts' | 'grants';
export type YearRange = 3 | 5 | 10;

export interface KPICounts {
  contracts: number;
  subcontracts: number;
  grants: number;
  subgrants: number;
}

export interface YearAggregate {
  year: number;
  contracts: number;
  subcontracts: number;
  grants: number;
  subgrants: number;
}

export interface RankedRow {
  rank: number;
  name: string;
  obligations: number;
  pct?: number;
}

export interface FederalAwardAnalysisChartProps {
  kpis: KPICounts;
  trendData: YearAggregate[];
  vehicleRankings?: RankedRow[];
  awardeeRankings?: RankedRow[];
  type: AnalysisType;
  onTypeChange: (t: AnalysisType) => void;
  years: YearRange;
  onYearsChange: (y: YearRange) => void;
  onExport?: () => void;
  className?: string;
  isLoading?: boolean;
}

const COLORS = {
  contracts:   '#E64833',  // brand vermilion
  subcontracts:'#FBA08C',  // soft vermilion
  grants:      '#90AEAD',  // brand sage
  subgrants:   '#C8DDDC',  // soft sage
};

type SubTab = 'trends' | 'shares' | 'categories' | 'maps' | 'vehicles' | 'awardees';

export function FederalAwardAnalysisChart(props: FederalAwardAnalysisChartProps) {
  const { kpis, trendData, vehicleRankings, awardeeRankings, type, onTypeChange, years, onYearsChange, onExport, className, isLoading } = props;
  const [tab, setTab] = React.useState<SubTab>('trends');

  const total = kpis.contracts + kpis.subcontracts + kpis.grants + kpis.subgrants;

  return (
    <div className={cn('flex flex-col gap-4', className)}>
      {/* Top controls */}
      <div className="flex flex-wrap items-center gap-2">
        <Picker
          options={[
            { id: 'all',       label: 'All Awards' },
            { id: 'contracts', label: 'Contracts' },
            { id: 'grants',    label: 'Grants' },
          ]}
          value={type}
          onChange={(v) => onTypeChange(v as AnalysisType)}
        />
        <Picker
          options={[
            { id: '3',  label: '3 Years' },
            { id: '5',  label: '5 Years' },
            { id: '10', label: '10 Years' },
          ]}
          value={String(years)}
          onChange={(v) => onYearsChange(Number(v) as YearRange)}
        />
        <div className="ml-auto" />
        {onExport && (
          <button
            type="button" onClick={onExport}
            className="rounded-md border border-border bg-brand-teal-deep/40 px-3 py-1.5 text-[13px] text-foreground transition-colors hover:bg-brand-teal-soft/30"
          >
            Export
          </button>
        )}
      </div>

      {/* KPI cards */}
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
        <KPI label="Contracts"     value={kpis.contracts}     color={COLORS.contracts} />
        <KPI label="Subcontracts"  value={kpis.subcontracts}  color={COLORS.subcontracts} />
        <KPI label="Grants"        value={kpis.grants}        color={COLORS.grants} />
        <KPI label="Subgrants"     value={kpis.subgrants}     color={COLORS.subgrants} />
        <KPI label="Total"         value={total}              color="#FBE9D0" emphasis />
      </div>

      {/* Sub-tab bar */}
      <div role="tablist" className="flex flex-wrap items-center gap-1 border-b border-border/50">
        {([
          ['trends',     'Trends'],
          ['shares',     'Shares'],
          ['categories', 'Categories'],
          ['maps',       'Maps'],
          ['vehicles',   'Vehicle Rankings'],
          ['awardees',   'Awardee Rankings'],
        ] as const).map(([id, label]) => (
          <button
            key={id} role="tab" aria-selected={tab === id}
            onClick={() => setTab(id)}
            className={cn(
              'relative px-3 py-2 text-[12px] font-medium transition-colors',
              tab === id ? 'text-foreground' : 'text-muted-soft hover:text-foreground',
            )}
          >
            {label}
            {tab === id && (
              <span className="absolute inset-x-3 -bottom-px h-0.5 rounded-full bg-brand-vermilion" />
            )}
          </button>
        ))}
      </div>

      {/* Chart area */}
      <div className="min-h-[320px]">
        {isLoading ? (
          <div className="grid h-80 place-items-center text-sm text-muted-soft">Loading…</div>
        ) : tab === 'trends' ? (
          <ResponsiveContainer width="100%" height={320}>
            <BarChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="year" stroke="#90AEAD" />
              <YAxis stroke="#90AEAD" tickFormatter={(v) => fmtMoney(v)} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={tooltipStyle} />
              <Legend />
              <Bar dataKey="contracts"    stackId="a" fill={COLORS.contracts}    name="Contracts" />
              <Bar dataKey="subcontracts" stackId="a" fill={COLORS.subcontracts} name="Subcontracts" />
              <Bar dataKey="grants"       stackId="a" fill={COLORS.grants}       name="Grants" />
              <Bar dataKey="subgrants"    stackId="a" fill={COLORS.subgrants}    name="Subgrants" />
            </BarChart>
          </ResponsiveContainer>
        ) : tab === 'shares' ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={trendData}>
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="year" stroke="#90AEAD" />
              <YAxis stroke="#90AEAD" tickFormatter={(v) => fmtMoney(v)} />
              <Tooltip formatter={(v: number) => fmtMoney(v)} contentStyle={tooltipStyle} />
              <Legend />
              <Area type="monotone" dataKey="contracts"    stackId="1" stroke={COLORS.contracts}    fill={COLORS.contracts}    fillOpacity={0.6} name="Contracts" />
              <Area type="monotone" dataKey="subcontracts" stackId="1" stroke={COLORS.subcontracts} fill={COLORS.subcontracts} fillOpacity={0.6} name="Subcontracts" />
              <Area type="monotone" dataKey="grants"       stackId="1" stroke={COLORS.grants}       fill={COLORS.grants}       fillOpacity={0.6} name="Grants" />
              <Area type="monotone" dataKey="subgrants"    stackId="1" stroke={COLORS.subgrants}    fill={COLORS.subgrants}    fillOpacity={0.6} name="Subgrants" />
            </AreaChart>
          </ResponsiveContainer>
        ) : tab === 'categories' ? (
          <ResponsiveContainer width="100%" height={320}>
            <AreaChart data={trendData} stackOffset="expand">
              <CartesianGrid strokeDasharray="3 3" stroke="rgba(255,255,255,0.06)" />
              <XAxis dataKey="year" stroke="#90AEAD" />
              <YAxis stroke="#90AEAD" tickFormatter={(v) => `${(v * 100).toFixed(0)}%`} />
              <Tooltip formatter={(v: number) => `${(v * 100).toFixed(1)}%`} contentStyle={tooltipStyle} />
              <Legend />
              <Area type="monotone" dataKey="contracts"    stackId="1" stroke={COLORS.contracts}    fill={COLORS.contracts}    fillOpacity={0.7} name="Contracts" />
              <Area type="monotone" dataKey="subcontracts" stackId="1" stroke={COLORS.subcontracts} fill={COLORS.subcontracts} fillOpacity={0.7} name="Subcontracts" />
              <Area type="monotone" dataKey="grants"       stackId="1" stroke={COLORS.grants}       fill={COLORS.grants}       fillOpacity={0.7} name="Grants" />
              <Area type="monotone" dataKey="subgrants"    stackId="1" stroke={COLORS.subgrants}    fill={COLORS.subgrants}    fillOpacity={0.7} name="Subgrants" />
            </AreaChart>
          </ResponsiveContainer>
        ) : tab === 'vehicles' ? (
          <RankingTable rows={vehicleRankings ?? []} valueLabel="Obligations" />
        ) : tab === 'awardees' ? (
          <RankingTable rows={awardeeRankings ?? []} valueLabel="Obligations" />
        ) : (
          <div className="grid h-80 place-items-center rounded-xl border border-border bg-brand-teal-deep/25 text-sm text-muted">
            Choropleth map ships in Phase 1.5 — Leaflet bundle deferred for first paint.
          </div>
        )}
      </div>
    </div>
  );
}

function KPI({ label, value, color, emphasis }: { label: string; value: number; color: string; emphasis?: boolean }) {
  return (
    <div className={cn(
      'flex flex-col gap-0.5 rounded-lg border border-border bg-brand-teal-deep/30 px-3 py-2',
      emphasis && 'border-brand-vermilion/40 bg-brand-vermilion/5',
    )}>
      <span className="text-[10px] font-bold uppercase tracking-[0.10em] text-muted-soft">{label}</span>
      <span className="text-lg font-bold tabular-nums" style={{ color }}>
        {fmtMoney(value)}
      </span>
    </div>
  );
}

function Picker<T extends string>({
  options, value, onChange,
}: {
  options: { id: T; label: string }[];
  value: T;
  onChange: (id: T) => void;
}) {
  return (
    <div role="tablist" className="inline-flex rounded-md border border-border bg-brand-teal-deep/30 p-0.5 text-[12px]">
      {options.map((o) => (
        <button
          key={o.id} role="tab" aria-selected={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn(
            'rounded px-2.5 py-1 transition-colors',
            value === o.id ? 'bg-brand-teal-soft/40 text-foreground' : 'text-muted-soft hover:text-foreground',
          )}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function RankingTable({ rows, valueLabel }: { rows: RankedRow[]; valueLabel: string }) {
  if (!rows.length) return <div className="grid h-40 place-items-center text-sm text-muted-soft">No ranking data yet.</div>;
  return (
    <div className="overflow-hidden rounded-xl border border-border">
      <table className="w-full text-sm">
        <thead className="bg-brand-teal-deep/85">
          <tr>
            <th className="w-12 px-3 py-2 text-left text-[11px] uppercase text-muted-soft">#</th>
            <th className="px-3 py-2 text-left text-[11px] uppercase text-muted-soft">Name</th>
            <th className="px-3 py-2 text-right text-[11px] uppercase text-muted-soft">{valueLabel}</th>
            <th className="w-20 px-3 py-2 text-right text-[11px] uppercase text-muted-soft">Share</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((r) => (
            <tr key={r.rank} className="border-b border-border/40 last:border-0 hover:bg-brand-teal-soft/15">
              <td className="px-3 py-2 text-muted-soft tabular-nums">{r.rank}</td>
              <td className="px-3 py-2 text-foreground">{r.name}</td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">{fmtMoney(r.obligations)}</td>
              <td className="px-3 py-2 text-right text-muted tabular-nums">{r.pct ? `${r.pct.toFixed(1)}%` : '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

const tooltipStyle = {
  background: 'rgba(13, 31, 37, 0.95)',
  border:     '1px solid rgba(144, 174, 173, 0.25)',
  borderRadius: 8,
  color:      '#FBE9D0',
  fontSize:   12,
};
