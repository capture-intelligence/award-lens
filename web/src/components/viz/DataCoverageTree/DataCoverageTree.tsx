/* eslint-disable @typescript-eslint/no-explicit-any */
import { useEffect, useRef, useState } from 'react';
import * as d3 from 'd3';
import type { DataCoverageTreeProps, DataElement } from './types';
import { defaultStyleConfig, mergeConfig } from './defaults';
import { useResizeObserver } from '../useResizeObserver';
import './DataCoverageTree.css';

const DEFAULT_AVAILABILITY_COLORS = {
  root:       '#244855',
  both:       '#874F41',
  restricted: '#E64833',
  public:     '#90AEAD',
  category:   '#90AEAD',
};

// Number of "shades" we lift link colours away from their parent node
// colour. One shade ≈ 10% blend toward white, so 4 shades ≈ 40% — visibly
// softer than the node, still recognisably the same hue family.
const LINK_LIGHTEN_SHADES = 4;

/** Blend a hex/rgb colour toward white. shades * 0.10 = mix amount. */
function lighten(color: string, shades: number): string {
  const c = d3.rgb(color);
  const t = Math.min(1, Math.max(0, shades) * 0.10);
  c.r = c.r + (255 - c.r) * t;
  c.g = c.g + (255 - c.g) * t;
  c.b = c.b + (255 - c.b) * t;
  return c.formatHex();
}

export default function DataCoverageTree({
  data,
  width,
  height,
  availabilityColors,
  className = '',
  styleConfig: styleConfigOverride,
  onLeafClick,
}: DataCoverageTreeProps) {
  const cfg = mergeConfig(defaultStyleConfig, styleConfigOverride);
  const colors = { ...DEFAULT_AVAILABILITY_COLORS, ...availabilityColors };
  const svgRef = useRef<SVGSVGElement>(null);
  const { ref: containerRef, rect } = useResizeObserver<HTMLDivElement>();
  const [tooltip, setTooltip] = useState<{ visible: boolean; content: DataElement | null; x: number; y: number }>({
    visible: false,
    content: null,
    x: 0,
    y: 0,
  });

  const containerWidth  = width  || Math.max(800, rect.width  - 40);
  const containerHeight = height || Math.max(600, rect.height - 40);

  useEffect(() => {
    if (!svgRef.current || !data || containerWidth <= 0 || containerHeight <= 0) return;

    const isMobile = containerWidth < 768;
    const isTablet = containerWidth >= 768 && containerWidth < 1024;

    const nodeSpacingX = isMobile ? 160 : isTablet ? 200 : 250;
    const nodeSpacingY = isMobile ? 140 : isTablet ? 160 : 180;
    // 25% larger than the previous values (8/10/12) so each node carries
    // more visual weight and the lightened ring around it stays legible.
    const nodeRadius = isMobile ? 10 : isTablet ? 13 : 15;
    const fontSize = isMobile ? 12 : isTablet ? 13 : 14;
    const categoryFontSize = isMobile ? 14 : isTablet ? 15 : 16;

    const svg = d3.select(svgRef.current);
    svg.selectAll('*').remove();

    const g = svg
      .attr('width', containerWidth)
      .attr('height', containerHeight)
      .attr('viewBox', `0 0 ${containerWidth} ${containerHeight}`)
      .attr('preserveAspectRatio', 'xMidYMid meet')
      .append('g');

    // Initial centering transform — applied via zoom.transform below so the
    // d3.zoom behaviour and the <g> element share a single coordinate system.
    const initialTransform = d3.zoomIdentity.translate(containerWidth / 2, 80);

    const zoom = d3
      .zoom<SVGSVGElement, unknown>()
      .scaleExtent([cfg.zoomMin, cfg.zoomMax])
      // Ignore pointerdown/click on a node — those should expand/collapse,
      // not start a pan. (Without this filter, even 1–2px of movement during
      // a click registers as a drag and snaps `g` back to zoomIdentity,
      // sending the whole tree to the top-left corner.)
      .filter((event) => {
        if (!event) return true;
        const target = event.target as Element | null;
        if (target && target.closest && target.closest('.node')) return false;
        return !event.ctrlKey && !event.button;
      })
      .on('zoom', (event) => {
        g.attr('transform', event.transform.toString());
        setTooltip({ visible: false, content: null, x: 0, y: 0 });
      });

    svg.call(zoom);
    // Seed the zoom behaviour's internal transform to match the initial
    // centering. This also applies the transform to `g`, replacing the
    // explicit .attr('transform', ...) we used to set on creation.
    svg.call(zoom.transform, initialTransform);

    const root = d3.hierarchy(data) as any;
    root.x0 = 0;
    root.y0 = 0;

    // Recursively collapse everything below root's direct children.
    // Initial visible layer = root + its immediate children. Each subsequent
    // click expands ONE more layer (per the user's "one click, one layer"
    // rule), because every grandchild's own children sit in _children.
    function collapseAll(node: any) {
      if (node.children) {
        node.children.forEach(collapseAll);
        node._children = node.children;
        node.children = null;
      }
    }
    if (root.children) {
      root.children.forEach(collapseAll);
    }

    const treeLayout = d3.tree<any>().nodeSize([nodeSpacingX, nodeSpacingY]);

    function update(source: any) {
      const duration = cfg.animationDuration;
      const treeData = treeLayout(root);
      const nodes = treeData.descendants();
      const links = treeData.links();

      nodes.forEach((d: any) => (d.y = d.depth * nodeSpacingY));

      // Links
      const link = g.selectAll('.link').data(links, (d: any) => d.target.data.title);

      const linkEnter = link.enter().insert('g', 'g').attr('class', 'link');

      const linkStrokeWidth = isMobile ? cfg.linkBaseWidthMobile : isTablet ? cfg.linkBaseWidthTablet : cfg.linkBaseWidthDesktop;
      const linkOverlayWidth = isMobile ? cfg.linkOverlayWidthMobile : isTablet ? cfg.linkOverlayWidthTablet : cfg.linkOverlayWidthDesktop;

      // Resolve the link colour from the *target* node's intrinsic colour,
      // then lighten by 4 shades. Category/group nodes share the public
      // hue but we route them through the same helper so any future
      // category recolouring lightens links automatically.
      function linkStrokeFor(d: any): string {
        return strokeForData(d.target.data);
      }

      // Same lookup but takes a hierarchy node directly — used to give
      // each node's outer ring the exact colour and width as its
      // incoming link overlay, so the visual reads as one continuous
      // line of color terminating in a node.
      function strokeForData(data: any): string {
        const av = data.availability;
        let base: string;
        if (av === 'both') base = colors.both;
        else if (av === 'restricted') base = colors.restricted;
        else if (data.category) base = colors.category;
        else base = colors.public;
        return lighten(base, LINK_LIGHTEN_SHADES);
      }

      linkEnter
        .append('path')
        .attr('class', 'link-base')
        .attr('fill', 'none')
        .attr('stroke', linkStrokeFor)
        .attr('stroke-width', linkStrokeWidth)
        .attr('opacity', cfg.linkBaseOpacity)
        .attr('stroke-linecap', 'round')
        .attr('d', () => {
          const o = { x: source.x0, y: source.y0 };
          return diagonal({ source: o, target: o });
        });

      linkEnter.each(function (d: any) {
        const linkGroup = d3.select(this);

        linkGroup
          .append('path')
          .attr('class', 'link-overlay')
          .attr('fill', 'none')
          .attr('stroke', linkStrokeFor(d))
          .attr('stroke-width', linkOverlayWidth)
          .attr('opacity', cfg.linkOverlayOpacity)
          .attr('stroke-linecap', 'round')
          .attr('d', () => {
            const o = { x: source.x0, y: source.y0 };
            return diagonal({ source: o, target: o });
          });
      });

      const linkUpdate = linkEnter.merge(link as any);

      linkUpdate.select('.link-base').transition().duration(duration).attr('d', diagonal);
      linkUpdate.select('.link-overlay').transition().duration(duration).attr('d', diagonal);

      link.exit().transition().duration(duration).attr('opacity', 0).remove();

      // Nodes
      const node = g.selectAll('.node').data(nodes, (d: any) => d.data.title);

      const nodeEnter = node
        .enter()
        .append('g')
        .attr('class', 'node')
        .attr('transform', () => `translate(${source.x0},${source.y0})`)
        .on('click', (event, d: any) => {
          event.stopPropagation();

          const isLeaf = !d.children && !d._children;
          if (isLeaf) {
            // Leaf click → defer to caller (e.g., open AwardDetail panel).
            if (onLeafClick) onLeafClick(d.data as DataElement);
            return;
          }

          const isExpanding = !d.children && !!d._children;
          if (isExpanding && d.parent) {
            d.parent.children?.forEach((child: any) => {
              if (child !== d && child.children) {
                child._children = child.children;
                child.children = null;
              }
            });
          }
          if (d.children) {
            d._children = d.children;
            d.children = null;
          } else {
            d.children = d._children;
            d._children = null;
          }
          update(d);
        })
        .on('mouseenter', function (_event, d: any) {
          if (d.data.description || d.data.details || d.data.htmlDescription) {
            const circle = d3.select(this).select('circle').node() as SVGCircleElement;
            const r = circle.getBoundingClientRect();
            // Container-relative coords. Subtracting the container's BCR
            // gives us anchor points that work with the tooltip's
            // `position: absolute` styling — survives page scroll, zoom,
            // and any parent transforms cleanly.
            const cRect = containerRef.current?.getBoundingClientRect();
            setTooltip({
              visible: true,
              content: d.data,
              x: r.right - (cRect?.left ?? 0),
              y: r.top + r.height / 2 - (cRect?.top ?? 0),
            });
          }
          d3.select(this).select('circle').transition().duration(cfg.hoverDuration).attr('r', nodeRadius * 1.3);
        })
        .on('mouseleave', function () {
          setTooltip({ visible: false, content: null, x: 0, y: 0 });
          d3.select(this).select('circle').transition().duration(cfg.hoverDuration).attr('r', nodeRadius);
        });

      // Node circles
      nodeEnter.each(function (d: any) {
        const nodeGroup = d3.select(this);
        const availability = d.data.availability;
        const isCategory = d.data.category && d.depth > 0;
        const isRoot = d.depth === 0;
        const isLeaf = !d.children && !d._children;

        let fillColor = colors.public;
        if (isRoot) fillColor = colors.root;
        else if (availability === 'both') fillColor = colors.both;
        else if (availability === 'restricted') fillColor = colors.restricted;
        else if (isCategory) fillColor = colors.category;

        const cursor = isLeaf
          ? (onLeafClick ? 'pointer' : 'default')
          : (d.children || d._children ? 'pointer' : 'default');

        // Outer halo — wider stroke at lower opacity, matching the
        // link-base path. Drawn first so the body covers its interior,
        // leaving a visible halo ring outside the body's stroke. Lines
        // up exactly with the lighter halo on each incoming link.
        nodeGroup
          .append('circle')
          .attr('class', 'node-halo')
          .attr('r', nodeRadius)
          .attr('fill', 'none')
          .attr('stroke', strokeForData(d.data))
          .attr('stroke-width', linkStrokeWidth)
          .attr('opacity', cfg.linkBaseOpacity)
          .style('pointer-events', 'none');

        // Body — same colour as the link overlay, same stroke width,
        // so the visual reads as a single continuous line of color
        // that resolves at the node's outline.
        nodeGroup
          .append('circle')
          .attr('r', nodeRadius)
          .attr('fill', fillColor)
          .attr('stroke', strokeForData(d.data))
          .attr('stroke-width', linkOverlayWidth)
          .style('cursor', cursor)
          .style('filter', 'drop-shadow(0 4px 8px rgba(0, 0, 0, 0.2))');

        if (d._children || d.children) {
          // Geometric +/− via <line> elements — perfectly centered
          // by construction, regardless of font metrics, browser, or
          // glyph design. Always draw the horizontal stroke; add the
          // vertical stroke only when the node is collapsed (showing +
          // to indicate "click to expand"). Round line caps so the
          // strokes terminate cleanly inside the node.
          const indicatorHalf   = Math.round(nodeRadius * 0.42);
          const indicatorStroke = Math.max(1.5, nodeRadius * 0.18);
          const indicatorGroup  = nodeGroup
            .append('g')
            .attr('class', 'node-indicator')
            .style('pointer-events', 'none');
          indicatorGroup
            .append('line')
            .attr('x1', -indicatorHalf).attr('x2', indicatorHalf)
            .attr('y1', 0).attr('y2', 0)
            .attr('stroke', cfg.indicatorColor)
            .attr('stroke-width', indicatorStroke)
            .attr('stroke-linecap', 'round');
          if (d._children) {
            indicatorGroup
              .append('line')
              .attr('x1', 0).attr('x2', 0)
              .attr('y1', -indicatorHalf).attr('y2', indicatorHalf)
              .attr('stroke', cfg.indicatorColor)
              .attr('stroke-width', indicatorStroke)
              .attr('stroke-linecap', 'round');
          }
        }
      });

      // Node labels with word-wrap
      nodeEnter.each(function (d: any) {
        const nodeGroup = d3.select(this);
        const isCategory = d.data.category && d.depth > 0;
        const currentFontSize = d.depth === 0 ? cfg.rootFontSize : isCategory ? categoryFontSize : fontSize;
        const labelY = nodeRadius + 25;

        const measure = nodeGroup
          .append('text')
          .attr('y', labelY)
          .attr('text-anchor', 'middle')
          .attr('font-family', 'system-ui, -apple-system, sans-serif')
          .attr('font-size', `${currentFontSize}px`)
          .attr('font-weight', d.depth === 0 ? '700' : isCategory ? '600' : '500')
          .attr('fill', cfg.textColor)
          .style('pointer-events', 'none');

        const words = String(d.data.title ?? '').split(/\s+/);
        const maxWidth = isMobile ? 120 : isTablet ? 140 : 160;
        const lines: string[] = [];
        let currentLine = words[0];

        for (let i = 1; i < words.length; i++) {
          const testLine = currentLine + ' ' + words[i];
          measure.text(testLine);
          const testWidth = (measure.node() as SVGTextElement).getComputedTextLength();
          if (testWidth > maxWidth) {
            lines.push(currentLine);
            currentLine = words[i];
          } else {
            currentLine = testLine;
          }
        }
        lines.push(currentLine);
        measure.remove();

        lines.forEach((line, i) => {
          // Text outline (paint-order stroke) intentionally omitted — the
          // light highlight read as visual noise against the new lighter
          // canvas. Plain fill on the cream-bg holds enough contrast.
          nodeGroup
            .append('text')
            .attr('y', labelY + i * (currentFontSize + 2))
            .attr('text-anchor', 'middle')
            .attr('font-family', 'Montserrat, system-ui, sans-serif')
            .attr('font-size', `${currentFontSize}px`)
            .attr('font-weight', d.depth === 0 ? '700' : isCategory ? '600' : '500')
            .attr('fill', cfg.textColor)
            .style('pointer-events', 'none')
            .text(line);
        });
      });

      const nodeUpdate = nodeEnter.merge(node as any);

      nodeUpdate
        .transition()
        .duration(duration)
        .attr('transform', (d: any) => `translate(${d.x},${d.y})`);

      nodeUpdate.select('.node-indicator').text((d: any) => (d._children ? '+' : '−'));

      node
        .exit()
        .transition()
        .duration(duration)
        .attr('transform', () => `translate(${source.x},${source.y})`)
        .remove();

      nodes.forEach((d: any) => {
        d.x0 = d.x;
        d.y0 = d.y;
      });
    }

    function diagonal(d: any) {
      return `M${d.source.x},${d.source.y} C${d.source.x},${(d.source.y + d.target.y) / 2} ${d.target.x},${(d.source.y + d.target.y) / 2} ${d.target.x},${d.target.y}`;
    }

    update(root);

    svg.on('click', () => {
      setTooltip({ visible: false, content: null, x: 0, y: 0 });
    });
  }, [data, containerWidth, containerHeight]);

  return (
    <div ref={containerRef} className={`data-coverage-tree ${className}`}>
      <svg ref={svgRef}></svg>
      {tooltip.visible && tooltip.content && (
        <div
          className="data-coverage-tree__tooltip"
          style={{
            // Touches the node — 0px horizontal gap, vertically centered.
            left: `${tooltip.x}px`,
            top: `${tooltip.y}px`,
            transform: 'translateY(-50%)',
          }}
        >
          <div className="data-coverage-tree__tooltip-title">{tooltip.content.title}</div>
          {tooltip.content.description && (
            <div className="data-coverage-tree__tooltip-description">{tooltip.content.description}</div>
          )}
          {tooltip.content.htmlDescription && (
            <div
              className="data-coverage-tree__tooltip-html"
              dangerouslySetInnerHTML={{ __html: tooltip.content.htmlDescription }}
            />
          )}
          {tooltip.content.details && (
            <div className="data-coverage-tree__tooltip-details">{tooltip.content.details}</div>
          )}
        </div>
      )}
    </div>
  );
}
