/**
 * Bubble tab — force-directed bubble chart over the same filteredRows the
 * other Analytics tabs consume. Two modes:
 *   - Group  → one bubble per Nature / Expiry-bucket / Vendor; size = total
 *              current_value; click drills into Award mode for that group.
 *   - Award  → one bubble per top-N awards by current_value; click opens
 *              the AwardDetail side panel (same as Tree/Summary).
 */

import * as React from 'react';
import * as d3 from 'd3';
import { Card } from '@/components/ui/Card';
import { useSetSelectedAward } from '@/lib/ai-award-context';
import { natureOfWork, NATURE_BUCKETS } from '@/lib/nature-of-work';
import { useResizeObserver } from './useResizeObserver';
import { fmtMoney, fmtInt, cn } from '@/lib/utils';
import { ArrowLeft } from 'lucide-react';

// ─── Types ──────────────────────────────────────────────────────────────────

type Mode    = 'group' | 'award';
type GroupBy = 'nature' | 'expiry' | 'vendor';
type Layout  = 'cluster' | 'scatter' | 'pack';
type Row     = Record<string, unknown>;

interface BubbleNode extends d3.SimulationNodeDatum {
  key:        string;            // SVG join key
  label:      string;
  groupId:    string;            // for cluster centers + drill-down
  groupLabel: string;
  value:      number;            // for sizing
  color:      string;
  count?:     number;            // group-mode only
  award?:     Row;               // award-mode only
  r?:         number;            // injected after rScale
}

// ─── Palettes ───────────────────────────────────────────────────────────────

const NATURE_COLORS: Record<string, string> = {
  'Research / R&D':              '#a78bfa',
  'Data / Surveillance Systems': '#06b6d4',
  'IT / Software':               '#38bdf8',
  'Communications / Outreach':   '#fb7185',
  'Evaluation / Assessment':     '#f59e0b',
  'Program Support / PMO':       '#2dd4bf',
  'Goods / Equipment':           '#a3e635',
  'Other / Mixed':               '#7a7876',
};

interface ExpiryBucket {
  id:    string;
  label: string;
  color: string;
  test:  (days: number | null) => boolean;
  // Order index for the scatter layout (left → right, expired → far future).
  order: number;
}

const EXPIRY_BUCKETS: ExpiryBucket[] = [
  { id: 'expired',  label: 'Expired',     color: '#7a7876', order: 0, test: (d) => d != null && d < 0 },
  { id: 'lt30',     label: '< 30 days',   color: '#fb7185', order: 1, test: (d) => d != null && d >= 0 && d < 30 },
  { id: '30-90',    label: '30–90 days',  color: '#f59e0b', order: 2, test: (d) => d != null && d >= 30 && d < 90 },
  { id: '90-180',   label: '90–180 days', color: '#a3e635', order: 3, test: (d) => d != null && d >= 90 && d < 180 },
  { id: '180-365',  label: '180–365 d',   color: '#38bdf8', order: 4, test: (d) => d != null && d >= 180 && d < 365 },
  { id: 'gt365',    label: '> 365 days',  color: '#a78bfa', order: 5, test: (d) => d != null && d >= 365 },
  { id: 'unknown',  label: 'No end date', color: '#3f3e3c', order: 6, test: (d) => d == null },
];

const VENDOR_PALETTE = [
  '#2dd4bf', '#a78bfa', '#38bdf8', '#fb7185', '#a3e635',
  '#f59e0b', '#06b6d4', '#ec4899', '#84cc16', '#fbbf24',
  '#22d3ee', '#c084fc',
];

const TOP_N_AWARDS  = 100;
const TOP_N_VENDORS = 12;

// ─── Pure helpers ───────────────────────────────────────────────────────────

function expiryBucketFor(days: number | null): ExpiryBucket {
  for (const b of EXPIRY_BUCKETS) if (b.test(days)) return b;
  return EXPIRY_BUCKETS[EXPIRY_BUCKETS.length - 1];
}

function rowToGroupKey(r: Row, groupBy: GroupBy): { id: string; label: string; color: string; order: number } {
  if (groupBy === 'nature') {
    const n = natureOfWork({
      description:        (r.description       ?? '') as string,
      psc_description:    (r.psc_description   ?? '') as string,
      psc_code:           (r.psc_code          ?? '') as string,
      naics_description:  (r.naics_description ?? '') as string,
      naics_code:         (r.naics_code        ?? '') as string,
    });
    const order = NATURE_BUCKETS.indexOf(n as typeof NATURE_BUCKETS[number]);
    return { id: n, label: n, color: NATURE_COLORS[n] ?? '#7a7876', order: order < 0 ? 99 : order };
  }
  if (groupBy === 'expiry') {
    const d = Number(r.days_to_contract_end);
    const days = Number.isFinite(d) ? d : null;
    const b = expiryBucketFor(days);
    return { id: b.id, label: b.label, color: b.color, order: b.order };
  }
  // vendor
  const v = String(r.vendor_name ?? '(unknown vendor)');
  return { id: v, label: v, color: '#7a7876', order: 0 };
}

function buildGroupNodes(rows: Row[], groupBy: GroupBy): BubbleNode[] {
  const map = new Map<string, { label: string; color: string; order: number; total: number; count: number }>();
  for (const r of rows) {
    const key = rowToGroupKey(r, groupBy);
    const value = Number(r.current_value ?? 0);
    const cur = map.get(key.id);
    if (cur) {
      cur.total += value;
      cur.count += 1;
    } else {
      map.set(key.id, { label: key.label, color: key.color, order: key.order, total: value, count: 1 });
    }
  }
  let nodes: BubbleNode[] = Array.from(map.entries()).map(([id, v]) => ({
    key:        id,
    label:      v.label,
    groupId:    id,
    groupLabel: v.label,
    value:      v.total,
    color:      v.color,
    count:      v.count,
  }));
  if (groupBy === 'vendor') {
    // Top-N by total value, palette-colored; everything else collapses into
    // an "Other" bucket so the canvas stays readable on agencies with long
    // vendor tails.
    const sorted = [...nodes].sort((a, b) => b.value - a.value);
    const top    = sorted.slice(0, TOP_N_VENDORS).map((n, i) => ({
      ...n, color: VENDOR_PALETTE[i % VENDOR_PALETTE.length],
    }));
    const rest = sorted.slice(TOP_N_VENDORS);
    if (rest.length > 0) {
      top.push({
        key:        '__other_vendors__',
        label:      `Other (${rest.length} vendors)`,
        groupId:    '__other_vendors__',
        groupLabel: `Other (${rest.length} vendors)`,
        value:      rest.reduce((s, n) => s + n.value, 0),
        color:      '#3f3e3c',
        count:      rest.reduce((s, n) => s + (n.count ?? 1), 0),
      });
    }
    nodes = top;
  }
  return nodes;
}

function buildAwardNodes(rows: Row[], groupBy: GroupBy, focusGroupId: string | null): BubbleNode[] {
  let pool = rows;
  if (focusGroupId !== null) {
    pool = rows.filter((r) => rowToGroupKey(r, groupBy).id === focusGroupId);
  }
  const sorted = [...pool].sort(
    (a, b) => Number(b.current_value ?? 0) - Number(a.current_value ?? 0),
  );
  const top = sorted.slice(0, TOP_N_AWARDS);
  // For vendor coloring in award mode, assign palette by vendor rank too.
  const vendorRank = new Map<string, number>();
  if (groupBy === 'vendor') {
    const vendorTotals = new Map<string, number>();
    for (const r of pool) {
      const v = String(r.vendor_name ?? '(unknown vendor)');
      vendorTotals.set(v, (vendorTotals.get(v) ?? 0) + Number(r.current_value ?? 0));
    }
    Array.from(vendorTotals.entries())
      .sort((a, b) => b[1] - a[1])
      .forEach(([v], i) => vendorRank.set(v, i));
  }
  return top.map((r) => {
    const key  = rowToGroupKey(r, groupBy);
    const desc = String(r.description ?? '').trim() || '(no description)';
    let color  = key.color;
    if (groupBy === 'vendor') {
      const rank = vendorRank.get(key.id) ?? -1;
      color = rank >= 0 && rank < TOP_N_VENDORS
        ? VENDOR_PALETTE[rank % VENDOR_PALETTE.length]
        : '#3f3e3c';
    }
    return {
      key:        String(r.award_id ?? desc),
      label:      desc.slice(0, 60),
      groupId:    key.id,
      groupLabel: key.label,
      value:      Number(r.current_value ?? 0),
      color,
      award:      r,
    };
  });
}

// ─── Component ──────────────────────────────────────────────────────────────

interface Props {
  rows:     Row[];
  viewName: string;
}

export function AwardBubbleTab({ rows, viewName }: Props) {
  const setSelectedAward = useSetSelectedAward();

  const [mode,    setMode]    = React.useState<Mode>('group');
  const [groupBy, setGroupBy] = React.useState<GroupBy>('nature');
  const [layout,  setLayout]  = React.useState<Layout>('cluster');
  const [focusGroup, setFocusGroup] = React.useState<{ id: string; label: string } | null>(null);

  // Drill-down resets when the user changes grouping.
  React.useEffect(() => { setFocusGroup(null); }, [groupBy]);

  const nodes = React.useMemo<BubbleNode[]>(() => {
    if (mode === 'group') return buildGroupNodes(rows, groupBy);
    return buildAwardNodes(rows, groupBy, focusGroup?.id ?? null);
  }, [rows, mode, groupBy, focusGroup]);

  const totals = React.useMemo(() => {
    const total = rows.reduce((s, r) => s + Number(r.current_value ?? 0), 0);
    return { total, count: rows.length };
  }, [rows]);

  const handleBubbleClick = React.useCallback((n: BubbleNode) => {
    if (mode === 'group' && n.groupId !== '__other_vendors__') {
      // Drill from group into award mode, scoped to this group.
      setFocusGroup({ id: n.groupId, label: n.groupLabel });
      setMode('award');
      return;
    }
    if (mode === 'award' && n.award) {
      setSelectedAward(n.award);
    }
  }, [mode, setSelectedAward]);

  return (
    <Card className="flex flex-1 min-h-0 flex-col">
      {/* Header */}
      <div className="flex flex-wrap items-end justify-between gap-4 border-b border-border bg-brand-teal-deep/40 px-5 py-3">
        <div>
          <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-brand-sage">
            {focusGroup && (
              <button
                type="button"
                onClick={() => { setFocusGroup(null); setMode('group'); }}
                className="inline-flex items-center gap-1 rounded-md border border-border bg-brand-teal-deep/60 px-2 py-0.5 text-foreground hover:bg-brand-teal-soft/30"
              >
                <ArrowLeft className="h-3 w-3" /> Back
              </button>
            )}
            Bubble chart
            {focusGroup && (
              <span className="rounded-md bg-brand-vermilion/15 px-2 py-0.5 text-brand-vermilion-soft">
                {focusGroup.label}
              </span>
            )}
            · click {mode === 'group' ? 'a group to drill in' : 'an award for full detail'}
          </div>
          <div className="mt-0.5 text-xs text-muted">
            {viewName} · {fmtInt(totals.count)} contracts · {fmtMoney(totals.total)} total
            {mode === 'award' && totals.count > TOP_N_AWARDS && (
              <span className="ml-2 text-amber-300">(showing top {TOP_N_AWARDS} by value)</span>
            )}
          </div>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <SegControl<Mode>
            label="Mode"
            value={mode}
            onChange={(v) => { setMode(v); if (v === 'group') setFocusGroup(null); }}
            options={[
              { value: 'group', label: 'Group' },
              { value: 'award', label: 'Award' },
            ]}
          />
          <SegControl<GroupBy>
            label="Group by"
            value={groupBy}
            onChange={setGroupBy}
            options={[
              { value: 'nature', label: 'Nature of work' },
              { value: 'expiry', label: 'Days to expiry' },
              { value: 'vendor', label: 'Vendor' },
            ]}
          />
          <SegControl<Layout>
            label="Layout"
            value={layout}
            onChange={setLayout}
            options={[
              { value: 'cluster', label: 'Cluster' },
              { value: 'scatter', label: 'Scatter' },
              { value: 'pack',    label: 'Pack' },
            ]}
          />
        </div>
      </div>

      {/* Canvas */}
      <BubbleCanvas
        nodes={nodes}
        layout={layout}
        mode={mode}
        groupBy={groupBy}
        onBubbleClick={handleBubbleClick}
      />
    </Card>
  );
}

// ─── Segmented control ──────────────────────────────────────────────────────

function SegControl<T extends string>({
  label, value, onChange, options,
}: {
  label: string;
  value: T;
  onChange: (v: T) => void;
  options: Array<{ value: T; label: string }>;
}) {
  return (
    <div>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-[0.10em] text-muted-soft">
        {label}
      </div>
      <div className="inline-flex items-center rounded-lg border border-border bg-brand-teal-deep/60 p-0.5">
        {options.map((o) => (
          <button
            key={o.value}
            type="button"
            onClick={() => onChange(o.value)}
            className={cn(
              'rounded-md px-2.5 py-1 text-xs font-medium transition-colors',
              value === o.value
                ? 'bg-brand-vermilion text-white'
                : 'text-muted hover:text-foreground',
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

function BubbleCanvas({
  nodes, layout, mode, groupBy, onBubbleClick,
}: {
  nodes: BubbleNode[];
  layout: Layout;
  mode: Mode;
  groupBy: GroupBy;
  onBubbleClick: (n: BubbleNode) => void;
}) {
  const { ref: containerRef, rect } = useResizeObserver<HTMLDivElement>();
  const svgRef       = React.useRef<SVGSVGElement | null>(null);
  const tooltipRef   = React.useRef<HTMLDivElement | null>(null);
  // Latest click handler kept in a ref so the d3 listener doesn't go stale.
  const onClickRef   = React.useRef(onBubbleClick);
  React.useEffect(() => { onClickRef.current = onBubbleClick; }, [onBubbleClick]);

  React.useEffect(() => {
    const W = rect.width, H = rect.height;
    if (!svgRef.current || W < 50 || H < 50 || nodes.length === 0) return;
    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    // Radius scale
    const maxV = d3.max(nodes, (d) => d.value) ?? 1;
    const minV = d3.min(nodes, (d) => d.value) ?? 0;
    const minR = mode === 'group' ? 18 : 6;
    const maxR = Math.min(W, H) * (mode === 'group' ? 0.18 : 0.10);
    const rScale = d3.scaleSqrt().domain([Math.max(0, minV), Math.max(maxV, 1)]).range([minR, maxR]);
    nodes.forEach((n) => {
      n.r = rScale(n.value);
      // Seed positions in the center to avoid the initial "explosion" frame.
      if (n.x == null) n.x = W / 2 + (Math.random() - 0.5) * 80;
      if (n.y == null) n.y = H / 2 + (Math.random() - 0.5) * 80;
    });

    // Group-cluster centers (cluster + scatter both use them).
    const distinctGroups = Array.from(
      new Map(nodes.map((n) => [n.groupId, { id: n.groupId, label: n.groupLabel, color: n.color }])).values(),
    );
    const cols = distinctGroups.length <= 4 ? distinctGroups.length : Math.ceil(Math.sqrt(distinctGroups.length));
    const rows = Math.ceil(distinctGroups.length / cols);
    const padX = 80, padY = 90;
    const cellW = (W - padX * 2) / cols;
    const cellH = (H - padY * 2) / Math.max(rows, 1);
    const groupCenters: Record<string, { x: number; y: number }> = {};
    distinctGroups.forEach((g, i) => {
      groupCenters[g.id] = {
        x: padX + (i % cols) * cellW + cellW / 2,
        y: padY + Math.floor(i / cols) * cellH + cellH / 2,
      };
    });

    // Glow filter for the bubbles
    const defs = svg.append('defs');
    const flt = defs.append('filter').attr('id', 'awardlens-bubble-glow')
      .attr('x', '-40%').attr('y', '-40%').attr('width', '180%').attr('height', '180%');
    flt.append('feGaussianBlur').attr('stdDeviation', 4).attr('result', 'blur');
    const merge = flt.append('feMerge');
    merge.append('feMergeNode').attr('in', 'blur');
    merge.append('feMergeNode').attr('in', 'SourceGraphic');

    // Group labels (cluster layout only — they sit above each cluster)
    const labelLayer = svg.append('g').attr('class', 'group-labels');
    if (layout === 'cluster' && distinctGroups.length > 1) {
      distinctGroups.forEach((g) => {
        const c = groupCenters[g.id];
        const top = c.y - cellH / 2 + 18;
        labelLayer.append('text')
          .attr('x', c.x).attr('y', top)
          .attr('text-anchor', 'middle')
          .attr('font-size', 12).attr('font-weight', 700)
          .attr('letter-spacing', '0.06em')
          .attr('fill', g.color).attr('opacity', 0.85)
          .text(g.label.toUpperCase());
        labelLayer.append('line')
          .attr('x1', c.x - 36).attr('x2', c.x + 36)
          .attr('y1', top + 6).attr('y2', top + 6)
          .attr('stroke', g.color).attr('opacity', 0.3);
      });
    }
    if (layout === 'scatter') {
      labelLayer.append('text')
        .attr('x', W / 2).attr('y', H - 22)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11).attr('fill', '#7a7876')
        .attr('letter-spacing', '0.06em')
        .text(`← ${groupByAxisLabel(groupBy)} (left → right) →`);
      labelLayer.append('text')
        .attr('transform', `translate(20, ${H / 2}) rotate(-90)`)
        .attr('text-anchor', 'middle')
        .attr('font-size', 11).attr('fill', '#7a7876')
        .attr('letter-spacing', '0.06em')
        .text('← Smaller value · Larger value →');
    }

    // Bubble layer
    const bubbleLayer = svg.append('g').attr('class', 'bubbles');
    const sel = bubbleLayer.selectAll<SVGGElement, BubbleNode>('g.bubble')
      .data(nodes, (d) => (d as BubbleNode).key)
      .join((enter) => {
        const g = enter.append('g').attr('class', 'bubble').style('cursor', 'pointer');
        // Outer halo
        g.append('circle')
          .attr('class', 'halo')
          .attr('r', (d) => (d.r ?? 0) + 5)
          .attr('fill', (d) => d.color)
          .attr('opacity', 0.06);
        // Body
        g.append('circle')
          .attr('class', 'body')
          .attr('r', (d) => d.r ?? 0)
          .attr('fill', (d) => d.color)
          .attr('fill-opacity', 0.78)
          .attr('stroke', (d) => d.color)
          .attr('stroke-width', 1.4)
          .attr('stroke-opacity', 0.5)
          .attr('filter', 'url(#awardlens-bubble-glow)');
        // Highlight
        g.append('circle')
          .attr('class', 'shine')
          .attr('r',  (d) => (d.r ?? 0) * 0.45)
          .attr('cx', (d) => -(d.r ?? 0) * 0.18)
          .attr('cy', (d) => -(d.r ?? 0) * 0.22)
          .attr('fill', 'white').attr('opacity', 0.08);
        // Label
        g.append('text')
          .attr('text-anchor', 'middle')
          .attr('dominant-baseline', 'middle')
          .attr('font-weight', 700)
          .attr('fill', 'white')
          .attr('pointer-events', 'none')
          .attr('font-size', (d) => Math.max(8, Math.min((d.r ?? 0) * 0.32, 13)))
          .attr('opacity', (d) => (d.r ?? 0) > 18 ? 0.92 : 0)
          .text((d) => labelFor(d, mode));
        return g;
      });

    // Hover
    const tip = tooltipRef.current;
    sel
      .on('mouseover', function (_event, d) {
        d3.select(this).select<SVGCircleElement>('circle.body')
          .transition().duration(120).attr('r', (d.r ?? 0) * 1.08).attr('fill-opacity', 0.95);
        if (!tip) return;
        tip.classList.add('visible');
        tip.innerHTML = tooltipHtml(d, mode, groupBy);
      })
      .on('mousemove', function (event) {
        if (!tip) return;
        const e = event as MouseEvent;
        tip.style.left = `${Math.min(e.clientX + 14, window.innerWidth - 260)}px`;
        tip.style.top  = `${Math.min(e.clientY - 8,  window.innerHeight - 140)}px`;
      })
      .on('mouseout', function (_event, d) {
        d3.select(this).select<SVGCircleElement>('circle.body')
          .transition().duration(160).attr('r', d.r ?? 0).attr('fill-opacity', 0.78);
        if (tip) tip.classList.remove('visible');
      })
      .on('click', (_event, d) => onClickRef.current(d));

    // Force simulation
    const sim = d3.forceSimulation<BubbleNode>(nodes)
      .alphaDecay(0.04)
      .force('collide', d3.forceCollide<BubbleNode>((d) => (d.r ?? 0) + 3).strength(0.9).iterations(3))
      .force('charge',  d3.forceManyBody().strength(-22));

    if (layout === 'cluster') {
      sim
        .force('x', d3.forceX<BubbleNode>((d) => groupCenters[d.groupId]?.x ?? W / 2).strength(0.15))
        .force('y', d3.forceY<BubbleNode>((d) => groupCenters[d.groupId]?.y ?? H / 2).strength(0.15));
    } else if (layout === 'scatter') {
      // x by group order, y by log(value).
      const groupOrder = new Map(distinctGroups.map((g, i) => [g.id, i]));
      const numGroups = Math.max(distinctGroups.length, 1);
      const yScale = d3.scaleLog<number>()
        .domain([Math.max(minV, 1), Math.max(maxV, 2)])
        .range([H - padY - 20, padY])
        .clamp(true);
      sim
        .force('x', d3.forceX<BubbleNode>((d) => {
          const i = groupOrder.get(d.groupId) ?? 0;
          return padX + (i / Math.max(numGroups - 1, 1)) * (W - padX * 2);
        }).strength(0.18))
        .force('y', d3.forceY<BubbleNode>((d) => yScale(Math.max(d.value, 1))).strength(0.18));
    } else {
      sim
        .force('x', d3.forceX(W / 2).strength(0.06))
        .force('y', d3.forceY(H / 2).strength(0.06));
    }

    sim.on('tick', () => {
      sel.attr('transform', (d) => `translate(${d.x ?? 0},${d.y ?? 0})`);
    });

    return () => {
      sim.stop();
    };
  }, [nodes, layout, rect.width, rect.height, mode, groupBy]);

  return (
    <div ref={containerRef} className="relative flex-1 min-h-0">
      <svg ref={svgRef} className="block h-full w-full" />
      <div
        ref={tooltipRef}
        className="awardlens-bubble-tip pointer-events-none fixed z-50 max-w-[260px] rounded-lg border border-border bg-brand-teal-deep/95 px-3 py-2 text-xs text-foreground opacity-0 shadow-glass-lg backdrop-blur-md transition-opacity duration-100"
        style={{ left: -9999, top: -9999 }}
      />
      <style>{`.awardlens-bubble-tip.visible{opacity:1;}`}</style>
    </div>
  );
}

function labelFor(d: BubbleNode, mode: Mode): string {
  if (mode === 'group') {
    return d.count != null ? `${d.label} · ${d.count}` : d.label;
  }
  return d.label;
}

function groupByAxisLabel(g: GroupBy): string {
  return g === 'nature' ? 'Nature of work' : g === 'expiry' ? 'Days to expiry' : 'Vendor';
}

function tooltipHtml(d: BubbleNode, mode: Mode, groupBy: GroupBy): string {
  const esc = (s: string) => s.replace(/[<>&]/g, (c) => c === '<' ? '&lt;' : c === '>' ? '&gt;' : '&amp;');
  if (mode === 'group') {
    return `
      <div class="text-sm font-semibold text-foreground">${esc(d.label)}</div>
      <div class="mt-0.5 text-[10px] uppercase tracking-[0.10em]" style="color:${d.color}">${esc(groupByAxisLabel(groupBy))}</div>
      <div class="mt-2 flex justify-between gap-4 text-muted-soft">
        <span>Total value</span><span class="font-mono text-foreground">${fmtMoney(d.value)}</span>
      </div>
      <div class="flex justify-between gap-4 text-muted-soft">
        <span>Contracts</span><span class="font-mono text-foreground">${fmtInt(d.count ?? 0)}</span>
      </div>
      ${d.groupId === '__other_vendors__' ? '' : '<div class="mt-2 text-[10px] text-brand-sage">Click to drill in →</div>'}
    `;
  }
  const r = d.award ?? {};
  const days = Number(r.days_to_contract_end);
  const daysLabel = Number.isFinite(days)
    ? days < 0 ? `${Math.abs(days)}d ago` : `${days}d left`
    : '—';
  return `
    <div class="text-sm font-semibold text-foreground">${esc(d.label)}</div>
    <div class="mt-0.5 text-[10px] uppercase tracking-[0.10em]" style="color:${d.color}">${esc(d.groupLabel)}</div>
    <div class="mt-2 flex justify-between gap-4 text-muted-soft">
      <span>Vendor</span><span class="text-foreground">${esc(String(r.vendor_name ?? '—'))}</span>
    </div>
    <div class="flex justify-between gap-4 text-muted-soft">
      <span>Value</span><span class="font-mono text-foreground">${fmtMoney(d.value)}</span>
    </div>
    <div class="flex justify-between gap-4 text-muted-soft">
      <span>Ends</span><span class="text-foreground">${daysLabel}</span>
    </div>
    <div class="mt-2 text-[10px] text-brand-sage">Click for full detail →</div>
  `;
}
