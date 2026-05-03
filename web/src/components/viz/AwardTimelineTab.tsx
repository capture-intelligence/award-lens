/**
 * Timeline tab — variable-height "pill Gantt" over the same filteredRows
 * the rest of Analytics consumes.
 *
 * Encoding:
 *   X        time      contract start (left edge) → end (right edge)
 *   Y        band      one row per award, ordered by the active sort
 *   height   linear    pill thickness encodes current_value (taller = larger)
 *   color    nominal   nature of work / vendor / agency (configurable)
 *
 * Each pill is an SVG <rect> with rx = ry = h / 2, so it stays a perfect
 * capsule regardless of thickness, vertically centered on its row's
 * midpoint. Pill height is clamped to [minH, bandwidth - 2] so low-value
 * items stay visible and high-value rows don't overlap their neighbors.
 */

import * as React from 'react';
import { createPortal } from 'react-dom';
import * as d3 from 'd3';
import { Card } from '@/components/ui/Card';
import { useSetSelectedAward } from '@/lib/ai-award-context';
import { natureOfWork } from '@/lib/nature-of-work';
import { NATURE_COLORS, NATURE_FALLBACK } from '@/lib/nature-palette';
import { useResizeObserver } from './useResizeObserver';
import { fmtMoney, fmtInt, fmtDate, cn } from '@/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

type ColorBy = 'nature' | 'vendor' | 'agency';
type SortBy  = 'start_asc' | 'end_asc' | 'value_desc' | 'value_asc';
type TopN    = 20 | 50 | 100;
type Row     = Record<string, unknown>;

interface PillNode {
  id:    string;
  award: Row;
  name:  string;
  start: Date;
  end:   Date;
  value: number;
  group: string;
  color: string;
}

// ─── Earthy palette ─────────────────────────────────────────────────────────
// Nature-of-work colors come from the shared @/lib/nature-palette module
// so Clusters and Timeline always speak the same visual language.
// Vendor / agency coloring uses the rank-keyed rotation below.

const PALETTE_BY_RANK = [
  '#874F41', '#5d9099', '#90AEAD', '#c0954a',
  '#9c7aa1', '#5a7d8a', '#a87a52', '#d2674a',
  '#7a9594', '#9aa861', '#7d7167', '#a05a4d',
];

// ─── Pure helpers ───────────────────────────────────────────────────────────

function parseDate(s: unknown): Date | null {
  if (typeof s !== 'string' || !s) return null;
  // pop_start_date / pop_end_date are stored as YYYY-MM-DD; treat as
  // local midnight so toolbox time zones don't shift the bar by a day.
  const d = new Date(`${s}T00:00:00`);
  return Number.isNaN(d.getTime()) ? null : d;
}

function compare(a: Row, b: Row, sortBy: SortBy): number {
  const av = Number(a.current_value ?? 0);
  const bv = Number(b.current_value ?? 0);
  if (sortBy === 'value_desc') return bv - av;
  if (sortBy === 'value_asc')  return av - bv;
  const ka = sortBy === 'start_asc' ? parseDate(a.pop_start_date) : parseDate(a.pop_end_date);
  const kb = sortBy === 'start_asc' ? parseDate(b.pop_start_date) : parseDate(b.pop_end_date);
  if (!ka && !kb) return 0;
  if (!ka) return 1;
  if (!kb) return -1;
  return ka.getTime() - kb.getTime();
}

function natureFor(r: Row): string {
  return natureOfWork({
    description:        (r.description       ?? '') as string,
    psc_description:    (r.psc_description   ?? '') as string,
    psc_code:           (r.psc_code          ?? '') as string,
    naics_description:  (r.naics_description ?? '') as string,
    naics_code:         (r.naics_code        ?? '') as string,
  });
}

function buildNodes(
  rows: Row[],
  colorBy: ColorBy,
  sortBy: SortBy,
  topN: TopN,
): PillNode[] {
  // Only awards with both endpoints can be plotted on the time axis.
  const valid = rows.filter(
    (r) => parseDate(r.pop_start_date) && parseDate(r.pop_end_date),
  );
  // Pick top-N by value first (so the chart shows the biggest contracts),
  // then re-sort by the user's chosen axis ordering.
  const top = [...valid]
    .sort((a, b) => Number(b.current_value ?? 0) - Number(a.current_value ?? 0))
    .slice(0, topN)
    .sort((a, b) => compare(a, b, sortBy));

  // Build a stable rank map for vendor / agency coloring so the same
  // entity gets the same palette slot across renders.
  const groupRank = new Map<string, number>();
  if (colorBy !== 'nature') {
    const totals = new Map<string, number>();
    const keyOf = (r: Row) =>
      colorBy === 'vendor'
        ? String(r.vendor_name      ?? '(unknown)')
        : String(r.awarding_agency  ?? '(unknown)');
    for (const r of top) {
      const k = keyOf(r);
      totals.set(k, (totals.get(k) ?? 0) + Number(r.current_value ?? 0));
    }
    Array.from(totals.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([k], i) => groupRank.set(k, i));
  }

  return top.map((r, i) => {
    const start = parseDate(r.pop_start_date)!;
    const end   = parseDate(r.pop_end_date)!;
    const value = Number(r.current_value ?? 0);
    let group = '';
    let color = NATURE_FALLBACK;
    if (colorBy === 'nature') {
      group = natureFor(r);
      color = (NATURE_COLORS as Record<string, string>)[group] ?? NATURE_FALLBACK;
    } else {
      group = colorBy === 'vendor'
        ? String(r.vendor_name     ?? '(unknown)')
        : String(r.awarding_agency ?? '(unknown)');
      const rank = groupRank.get(group) ?? 0;
      color = PALETTE_BY_RANK[rank % PALETTE_BY_RANK.length];
    }
    return {
      id:    String(r.award_id ?? `idx-${i}`),
      award: r,
      name:  (String(r.description ?? '').trim() || '(no description)'),
      start,
      end,
      value,
      group,
      color,
    };
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  rows:     Row[];
  viewName: string;
}

export function AwardTimelineTab({ rows, viewName }: Props) {
  const setSelectedAward = useSetSelectedAward();
  const [colorBy, setColorBy] = React.useState<ColorBy>('nature');
  const [sortBy,  setSortBy]  = React.useState<SortBy>('start_asc');
  const [topN,    setTopN]    = React.useState<TopN>(50);

  const nodes = React.useMemo(
    () => buildNodes(rows, colorBy, sortBy, topN),
    [rows, colorBy, sortBy, topN],
  );

  const totals = React.useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.current_value ?? 0), 0);
    const eligible = rows.filter(
      (r) => parseDate(r.pop_start_date) && parseDate(r.pop_end_date),
    ).length;
    return { total, count: rows.length, eligible };
  }, [rows]);

  // Distinct categories present in the current pill set, for the legend.
  const legendItems = React.useMemo(() => {
    const seen = new Map<string, string>();
    nodes.forEach((n) => { if (!seen.has(n.group)) seen.set(n.group, n.color); });
    return Array.from(seen.entries()).map(([label, color]) => ({ label, color }));
  }, [nodes]);

  return (
    <Card className="flex flex-1 min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-brand-teal-deep/40 px-5 py-3.5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.16em] text-brand-sage">
            <span>Timeline</span>
            <span className="text-muted-soft">·</span>
            <span className="text-muted-soft">click a pill for full detail</span>
          </div>
          <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-1 leading-tight">
            <span className="font-serif text-[24px] font-medium italic tracking-tight text-brand-cream" style={{ fontVariationSettings: '"opsz" 144' }}>
              {viewName}
            </span>
            <span className="text-[13px] font-medium text-muted">
              <span className="font-mono tabular-nums text-brand-sage">{fmtInt(totals.eligible)}</span>
              <span className="ml-1 text-muted-soft">with PoP dates</span>
              <span className="mx-2 text-muted-soft/60">·</span>
              <span className="font-mono tabular-nums text-brand-sage">{fmtMoney(totals.total)}</span>
              <span className="ml-1 text-muted-soft">total</span>
            </span>
            {totals.eligible > topN && (
              <span className="text-[11px] uppercase tracking-[0.16em] text-brand-vermilion-soft/80">
                top {topN} by value
              </span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <SegControl<ColorBy>
            label="Color by"
            value={colorBy}
            onChange={setColorBy}
            options={[
              { value: 'nature', label: 'Nature' },
              { value: 'vendor', label: 'Vendor' },
              { value: 'agency', label: 'Agency' },
            ]}
          />
          <SegControl<SortBy>
            label="Sort"
            value={sortBy}
            onChange={setSortBy}
            options={[
              { value: 'start_asc',  label: 'Start ↑' },
              { value: 'end_asc',    label: 'End ↑' },
              { value: 'value_desc', label: 'Value ↓' },
              { value: 'value_asc',  label: 'Value ↑' },
            ]}
          />
          <SegControl<TopN>
            label="Show"
            value={topN}
            onChange={(v) => setTopN(v)}
            options={[
              { value: 20,  label: 'Top 20'  },
              { value: 50,  label: 'Top 50'  },
              { value: 100, label: 'Top 100' },
            ]}
          />
        </div>
      </div>

      {/* Canvas */}
      <TimelineCanvas
        nodes={nodes}
        onPillClick={(n) => setSelectedAward(n.award)}
      />

      {/* Legend (only when more than one category is in view) */}
      {legendItems.length > 1 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 border-t border-border bg-brand-teal-deep/30 px-5 py-2.5 text-[11px] text-muted-soft">
          {legendItems.map((it) => (
            <span key={it.label} className="inline-flex items-center gap-1.5">
              <span className="block h-2.5 w-2.5 rounded-full" style={{ background: it.color }} />
              <span className="text-brand-cream/90">{it.label}</span>
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

// ─── Segmented control (mirrors AwardBubbleTab) ─────────────────────────────

function SegControl<T extends string | number>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div>
      <div className="mb-1 text-[9.5px] font-bold uppercase tracking-[0.16em] text-muted-soft">
        {label}
      </div>
      <div className="inline-flex items-center rounded-lg border border-border bg-brand-teal-deep/70 p-0.5 shadow-inner shadow-black/20">
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-[11.5px] font-semibold transition-all',
              value === o.value
                ? 'bg-brand-vermilion text-brand-cream shadow-sm shadow-brand-vermilion/25'
                : 'text-muted-soft hover:text-brand-cream',
            )}
          >
            {o.label}
          </button>
        ))}
      </div>
    </div>
  );
}

// ─── D3 canvas ──────────────────────────────────────────────────────────────

const MARGIN = { top: 18, right: 32, bottom: 38, left: 210 };
const LABEL_PAD_L = 8;       // left inset where Y labels begin
const MIN_PILL_H = 3;        // floor so the smallest contract still renders
const LABEL_MAX_CHARS = 32;  // truncated from the right with ellipsis

function TimelineCanvas({
  nodes, onPillClick,
}: {
  nodes: PillNode[];
  onPillClick: (n: PillNode) => void;
}) {
  const { ref: containerRef, rect } = useResizeObserver<HTMLDivElement>();
  const svgRef     = React.useRef<SVGSVGElement | null>(null);
  const tooltipRef = React.useRef<HTMLDivElement | null>(null);
  const onClickRef = React.useRef(onPillClick);
  React.useEffect(() => { onClickRef.current = onPillClick; }, [onPillClick]);

  React.useEffect(() => {
    const W = rect.width, H = rect.height;
    if (!svgRef.current || W < 80 || H < 60 || nodes.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // ── Scales ────────────────────────────────────────────────────────────
    const minStart = d3.min(nodes, (n) => n.start) ?? new Date();
    const maxEnd   = d3.max(nodes, (n) => n.end)   ?? new Date();
    // Pad the time domain ~3% on each side so end-points don't kiss the axis.
    const pad = (maxEnd.getTime() - minStart.getTime()) * 0.03;
    const xScale = d3.scaleTime()
      .domain([new Date(minStart.getTime() - pad), new Date(maxEnd.getTime() + pad)])
      .range([MARGIN.left, W - MARGIN.right]);

    const yScale = d3.scaleBand<string>()
      .domain(nodes.map((n) => n.id))
      .range([MARGIN.top, H - MARGIN.bottom])
      .paddingInner(0.28);

    const bandwidth = yScale.bandwidth();
    const maxVal = d3.max(nodes, (n) => n.value) ?? 1;
    // Pill height is *exactly* proportional to current_value: domain starts
    // at 0 so a $0 contract resolves to MIN_PILL_H and the largest hits
    // (bandwidth - 2). At dense row counts the pills are thin; at top-20
    // they fill nearly the whole row.  No artificial 40px cap — the user
    // wants size to track value across the entire viewport.
    const maxPillH = Math.max(MIN_PILL_H + 2, bandwidth - 2);
    const heightScale = d3.scaleLinear()
      .domain([0, Math.max(maxVal, 1)])
      .range([MIN_PILL_H, maxPillH])
      .clamp(true);

    // ── Layers (back to front) ────────────────────────────────────────────
    const gridLayer  = svg.append('g').attr('class', 'grid');
    const todayLayer = svg.append('g').attr('class', 'today');
    const pillLayer  = svg.append('g').attr('class', 'pills');
    const xAxisLayer = svg.append('g').attr('class', 'x-axis');
    const yAxisLayer = svg.append('g').attr('class', 'y-axis');

    // ── Vertical gridlines (year ticks, dashed, behind pills) ─────────────
    // Dark teal at very low opacity reads as faint scaffolding on cream.
    const xTicks = xScale.ticks(Math.max(4, Math.floor((W - MARGIN.left - MARGIN.right) / 110)));
    gridLayer.selectAll('line')
      .data(xTicks)
      .join('line')
      .attr('x1', (d) => xScale(d)).attr('x2', (d) => xScale(d))
      .attr('y1', MARGIN.top).attr('y2', H - MARGIN.bottom)
      .attr('stroke', '#244855').attr('stroke-opacity', 0.10)
      .attr('stroke-dasharray', '3 4');

    // ── "Today" marker — narrow vermilion line + small label at the top.
    // Vermilion stays vermilion: high contrast on cream too.
    const today   = new Date();
    const todayX  = xScale(today);
    const inRange = todayX >= MARGIN.left && todayX <= W - MARGIN.right;
    if (inRange) {
      todayLayer.append('line')
        .attr('x1', todayX).attr('x2', todayX)
        .attr('y1', MARGIN.top - 2).attr('y2', H - MARGIN.bottom)
        .attr('stroke', '#E64833')
        .attr('stroke-width', 1.25)
        .attr('opacity', 0.85);
      todayLayer.append('text')
        .attr('x', todayX).attr('y', MARGIN.top - 6)
        .attr('text-anchor', 'middle')
        .attr('font-family', 'Inter, system-ui, sans-serif')
        .attr('font-size', 9).attr('font-weight', 800)
        .attr('letter-spacing', '0.20em')
        .attr('fill', '#E64833').attr('fill-opacity', 1)
        .text('TODAY');
    }

    // Horizontal row separators — barely-there hairlines so the eye
    // can track left to right without the lines competing for attention.
    yAxisLayer.selectAll('line.row-rule')
      .data(nodes)
      .join('line')
      .attr('class', 'row-rule')
      .attr('x1', MARGIN.left).attr('x2', W - MARGIN.right)
      .attr('y1', (n) => yScale(n.id)! + yScale.bandwidth() + (yScale.step() - yScale.bandwidth()) / 2)
      .attr('y2', (n) => yScale(n.id)! + yScale.bandwidth() + (yScale.step() - yScale.bandwidth()) / 2)
      .attr('stroke', '#244855').attr('stroke-opacity', 0.06);

    // ── X axis (bottom, time format adapts to span) ───────────────────────
    // D3 picks "nice" tick intervals — quarterly for multi-year spans,
    // monthly for spans under ~3 years. For the quarterly case we anchor
    // the full year only on Q1 ticks; Q2/Q3/Q4 stay bare. The pattern
    // reads as a calendar — year resets where the eye expects to find
    // it, and the axis stays readable at high tick density.
    const span    = maxEnd.getTime() - minStart.getTime();
    const oneYear = 365 * 24 * 3600 * 1000;
    const fmt: (d: Date) => string = span > 3 * oneYear
      ? (d) => {
          const q = Math.floor(d.getMonth() / 3) + 1;
          return q === 1 ? `Q1 ${d.getFullYear()}` : `Q${q}`;
        }
      : d3.timeFormat("%b '%y");
    const xAxis = d3.axisBottom(xScale)
      .ticks(xTicks.length)
      .tickFormat((d) => fmt(d as Date))
      .tickSize(0).tickPadding(8);
    xAxisLayer
      .attr('transform', `translate(0, ${H - MARGIN.bottom})`)
      .call(xAxis as any);
    xAxisLayer.select('.domain').attr('stroke', '#244855').attr('stroke-opacity', 0.20);
    xAxisLayer.selectAll('text')
      .attr('fill', '#244855').attr('fill-opacity', 0.78)
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('font-size', 10.5).attr('font-weight', 600)
      .attr('letter-spacing', '0.08em');

    // ── Y axis (left): truncated award descriptions ───────────────────────
    // text-anchor='start' anchors at the left inset so the text grows
    // rightward and never overflows past the SVG edge. Inter at 9.5 reads
    // as crisp ink on cream; deep teal pulls the eye without shouting.
    yAxisLayer.selectAll('text.row-label')
      .data(nodes)
      .join('text')
      .attr('class', 'row-label')
      .attr('x', LABEL_PAD_L)
      .attr('y', (n) => yScale(n.id)! + bandwidth / 2)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', 'start')
      .attr('font-family', 'Inter, system-ui, sans-serif')
      .attr('font-size', 9.5)
      .attr('font-weight', 600)
      .attr('letter-spacing', '0.01em')
      .attr('fill', '#1a3540').attr('fill-opacity', 0.85)
      .text((n) => truncate(n.name, LABEL_MAX_CHARS));

    // ── Inline $ value right before the start of each pill ───────────────
    // text-anchor='end' so the value's right edge sits 4px before the
    // pill. Skipped for pills that start within 56px of the chart's
    // left margin — there isn't room for the value without crashing
    // into the row label, and the user can read those values from the
    // tooltip on hover.
    yAxisLayer.selectAll('text.row-value')
      .data(nodes)
      .join('text')
      .attr('class', 'row-value')
      .attr('x', (n) => xScale(n.start) - 4)
      .attr('y', (n) => yScale(n.id)! + bandwidth / 2)
      .attr('dominant-baseline', 'middle')
      .attr('text-anchor', 'end')
      .attr('font-family', '"JetBrains Mono", ui-monospace, monospace')
      .attr('font-size', 9.5)
      .attr('font-weight', 600)
      .attr('font-variant-numeric', 'tabular-nums')
      .attr('fill', '#874F41')          // brand-terracotta — accent for data
      .attr('fill-opacity', 0.92)
      .attr('display', (n) =>
        xScale(n.start) - MARGIN.left < 56 ? 'none' : null,
      )
      .text((n) => fmtMoney(n.value));

    // ── Pills ─────────────────────────────────────────────────────────────
    const tip = tooltipRef.current;
    const pills = pillLayer.selectAll<SVGRectElement, PillNode>('rect.pill')
      .data(nodes, (d) => (d as PillNode).id)
      .join('rect')
      .attr('class', 'pill')
      .attr('x', (n) => Math.min(xScale(n.start), xScale(n.end)))
      .attr('y', (n) => {
        const rowY  = yScale(n.id)!;
        const h     = heightScale(n.value);
        return rowY + bandwidth / 2 - h / 2;
      })
      .attr('width', (n) => Math.max(2, Math.abs(xScale(n.end) - xScale(n.start))))
      .attr('height', (n) => heightScale(n.value))
      .attr('rx', (n) => heightScale(n.value) / 2)
      .attr('ry', (n) => heightScale(n.value) / 2)
      .attr('fill', (n) => n.color)
      .attr('fill-opacity', 0.92)
      .attr('stroke', (n) => n.color)
      .attr('stroke-opacity', 0.7)
      .attr('stroke-width', 1.1)
      .style('cursor', 'pointer');

    pills
      .on('mouseover', function (event, d) {
        d3.select(this).transition().duration(120).attr('fill-opacity', 1);
        if (!tip) return;
        tip.innerHTML = tooltipHtml(d);
        const e = event as MouseEvent;
        placeTooltipAtCursor(tip, e.clientX, e.clientY);
        tip.classList.add('visible');
      })
      .on('mousemove', function (event) {
        if (!tip) return;
        const e = event as MouseEvent;
        placeTooltipAtCursor(tip, e.clientX, e.clientY);
      })
      .on('mouseout', function () {
        d3.select(this).transition().duration(160).attr('fill-opacity', 0.92);
        if (tip) tip.classList.remove('visible');
      })
      .on('click', (_event, d) => onClickRef.current(d));

  }, [nodes, rect.width, rect.height]);

  return (
    <div
      ref={containerRef}
      className="relative flex-1 min-h-0"
      style={{ background: '#fffdf9' }}
    >
      <svg ref={svgRef} className="block h-full w-full" />
      {/* Portal the tooltip to <body> — App-shell has framer-motion
          wrappers whose CSS transform creates a containing block, which
          would otherwise hijack our position:fixed and clip the tooltip
          inside the route panel. body has no transform, so 'fixed' here
          truly resolves to the viewport. */}
      {typeof document !== 'undefined' && createPortal(
        <div
          ref={tooltipRef}
          className="awardlens-timeline-tip pointer-events-none fixed z-[100] max-w-[280px] rounded-lg border border-border bg-brand-teal-deep/95 px-3 py-2 text-xs text-foreground opacity-0 shadow-glass-lg backdrop-blur-md transition-opacity duration-100"
          style={{ left: -9999, top: -9999 }}
        />,
        document.body,
      )}
      <style>{`.awardlens-timeline-tip.visible{opacity:1;}`}</style>
    </div>
  );
}

function truncate(s: string, n: number): string {
  if (s.length <= n) return s;
  return s.slice(0, n - 1).trimEnd() + '…';
}

// Place a tooltip near the cursor, clamped to a viewport-safe inset on
// every edge. Cursor-anchored (not element-anchored) so wide elements
// — like long Timeline pills that span most of the chart — don't push
// the tooltip off-screen. Right of cursor by default, falls back to
// left if it would overflow.
function placeTooltipAtCursor(tip: HTMLElement, clientX: number, clientY: number): void {
  const GAP  = 14;
  const EDGE = 8;
  const tipW = tip.offsetWidth;
  const tipH = tip.offsetHeight;
  const vw   = window.innerWidth;
  const vh   = window.innerHeight;

  let x = clientX + GAP;
  if (x + tipW > vw - EDGE) x = clientX - GAP - tipW;
  if (x < EDGE) x = EDGE;

  let y = clientY - tipH / 2;
  if (y < EDGE)             y = EDGE;
  if (y + tipH > vh - EDGE) y = vh - tipH - EDGE;

  tip.style.left = `${x}px`;
  tip.style.top  = `${y}px`;
}

function tooltipHtml(n: PillNode): string {
  const esc = (s: string) =>
    s.replace(/[<>&]/g, (c) => (c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;'));
  const r = n.award;
  const vendor = String(r.vendor_name ?? '—');
  const days = Number(r.days_to_contract_end);
  const daysLabel = Number.isFinite(days)
    ? days < 0 ? `${Math.abs(days)}d ago` : `${days}d left`
    : '—';
  return `
    <div class="flex items-center gap-1.5 text-[9.5px] font-bold uppercase tracking-[0.16em]" style="color:${n.color}">
      <span style="display:inline-block;width:6px;height:6px;border-radius:9999px;background:${n.color}"></span>
      ${esc(n.group)}
    </div>
    <div class="mt-1 text-[13.5px] font-bold leading-tight tracking-tight text-brand-cream">${esc(n.name)}</div>
    <div class="mt-2.5 space-y-1.5 border-t border-white/5 pt-2.5">
      <div class="flex items-baseline justify-between gap-4 leading-snug">
        <span class="text-[10.5px] uppercase tracking-[0.10em] text-muted-soft">Vendor</span>
        <span class="text-[12.5px] font-semibold text-brand-cream">${esc(vendor)}</span>
      </div>
      <div class="flex items-baseline justify-between gap-4 leading-snug">
        <span class="text-[10.5px] uppercase tracking-[0.10em] text-muted-soft">Period</span>
        <span class="font-mono text-[12px] text-brand-cream">${fmtDate(n.start.toISOString().slice(0, 10))} → ${fmtDate(n.end.toISOString().slice(0, 10))}</span>
      </div>
      <div class="flex items-baseline justify-between gap-4 leading-snug">
        <span class="text-[10.5px] uppercase tracking-[0.10em] text-muted-soft">Value</span>
        <span class="font-mono text-[12.5px] font-semibold text-brand-cream">${fmtMoney(n.value)}</span>
      </div>
      <div class="flex items-baseline justify-between gap-4 leading-snug">
        <span class="text-[10.5px] uppercase tracking-[0.10em] text-muted-soft">Ends</span>
        <span class="text-[12.5px] font-semibold text-brand-cream">${daysLabel}</span>
      </div>
    </div>
    <div class="mt-2.5 flex items-center gap-1 text-[10px] font-semibold tracking-[0.08em] text-brand-sage">
      <span>Click for full detail</span>
      <span aria-hidden="true">→</span>
    </div>
  `;
}
