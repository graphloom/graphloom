import type { PathSegment, Point, Size } from '@graphloom/core';
import type { SceneFrame } from './frame.js';
import type { RenderItem, RenderItemId } from './scene.js';
import { hitTestFrame, type Renderer } from './renderer.js';
import { createTextMeasurer, type TextStyle } from './text.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

let rendererSeq = 0;

/** Background grid configuration (P3-T09). */
export interface GridConfig {
  readonly visible: boolean;
  readonly style: 'dot' | 'line';
  /** Cell size in world units. */
  readonly size: number;
  readonly color: string;
}

/** Default grid: subtle dots every 20 world units. */
export const DEFAULT_GRID: GridConfig = {
  visible: true,
  style: 'dot',
  size: 20,
  color: '#d4d9e4',
};

/** Options for {@link createSvgRenderer}. */
export interface SvgRendererOptions {
  /** Draw an arrowhead marker at edge targets (default true). */
  readonly edgeArrows?: boolean;
  /** Initial grid configuration (merged over {@link DEFAULT_GRID}). */
  readonly grid?: Partial<GridConfig>;
}

/** The SVG backend: the {@link Renderer} contract plus its grid config API. */
export interface SvgRenderer extends Renderer {
  /** Updates the background grid and repaints it immediately if mounted. */
  setGrid(config: Partial<GridConfig>): void;
  /** The active grid configuration. */
  readonly grid: GridConfig;
}

const pathData = (item: RenderItem & { kind: 'path' }): string => {
  const [first, ...rest] = item.points;
  if (!first) return '';
  if (item.curve === 'cubic') {
    let d = `M ${first.x} ${first.y}`;
    for (let base = 1; base + 2 < item.points.length; base += 3) {
      const [c1, c2, to] = [rest[base - 1], rest[base], rest[base + 1]] as [Point, Point, Point];
      d += ` C ${c1.x} ${c1.y}, ${c2.x} ${c2.y}, ${to.x} ${to.y}`;
    }
    return d;
  }
  return `M ${first.x} ${first.y} ${rest.map((p) => `L ${p.x} ${p.y}`).join(' ')}`;
};

/** Serializes structured spec segments (P7-T01) into SVG path data. */
const segmentData = (segments: readonly PathSegment[]): string =>
  segments
    .map((s) => {
      switch (s.kind) {
        case 'M':
          return `M ${s.to.x} ${s.to.y}`;
        case 'L':
          return `L ${s.to.x} ${s.to.y}`;
        case 'C':
          return `C ${s.c1.x} ${s.c1.y}, ${s.c2.x} ${s.c2.y}, ${s.to.x} ${s.to.y}`;
        case 'Q':
          return `Q ${s.c.x} ${s.c.y}, ${s.to.x} ${s.to.y}`;
        case 'Z':
          return 'Z';
      }
    })
    .join(' ');

/** The SVG tag an item renders as. */
const tagFor = (item: RenderItem): string => {
  switch (item.kind) {
    case 'path':
    case 'marker':
      return 'path';
    case 'text':
      return 'text';
    case 'image':
      return 'image';
    case 'port':
      return 'circle';
    case 'icon':
      return 'rect'; // placeholder plate; glyph resolution is host territory
    case 'shape':
      switch (item.shape) {
        case 'ellipse':
          return 'ellipse';
        case 'polygon':
          return 'polygon';
        case 'path':
          return 'path';
        default:
          return 'rect';
      }
  }
};

/**
 * The SVG rendering backend (ADR-0002, GraphLoom code only — no D3 DOM).
 * Maps render items 1:1 to SVG elements inside layer groups
 * (background/edges/nodes/overlay), patches only dirty items, and applies
 * pan/zoom as a single transform on the world group. DPR needs no handling
 * here (vector output); the grid layer owns its own crispness (P3-T09).
 */
export function createSvgRenderer(options: SvgRendererOptions = {}): SvgRenderer {
  const measure = createTextMeasurer();
  const seq = rendererSeq++;
  const markerId = `graphloom-arrow-${seq}`;
  const gridId = `graphloom-grid-${seq}`;
  let grid: GridConfig = { ...DEFAULT_GRID, ...options.grid };
  let svg: SVGSVGElement | null = null;
  let world: SVGGElement | null = null;
  let background: SVGGElement | null = null;
  let layers: { edges: SVGGElement; nodes: SVGGElement } | null = null;
  let elements = new Map<RenderItemId, SVGElement>();
  let lastFrame: SceneFrame | null = null;

  /**
   * Draws the grid in viewport (screen) space: an SVG pattern offset by the
   * viewport translate modulo the cell, so panning scrolls it seamlessly
   * (infinite-canvas illusion) and vector output stays crisp at any zoom or
   * fractional DPR. Cell size doubles until it spans ≥ 12 screen px so deep
   * zoom-out never turns into solid ink.
   */
  const renderGrid = (viewport: SceneFrame['viewport']): void => {
    if (!background) return;
    background.replaceChildren();
    if (!grid.visible) return; // disabled grid renders nothing (perf)
    let spacing = grid.size * viewport.zoom;
    while (spacing < 12) spacing *= 2;
    const pattern = document.createElementNS(SVG_NS, 'pattern');
    pattern.setAttribute('id', gridId);
    pattern.setAttribute('patternUnits', 'userSpaceOnUse');
    pattern.setAttribute('width', String(spacing));
    pattern.setAttribute('height', String(spacing));
    // Anchor the pattern to the world origin: offset by translate mod cell.
    pattern.setAttribute('x', String(((viewport.x % spacing) + spacing) % spacing));
    pattern.setAttribute('y', String(((viewport.y % spacing) + spacing) % spacing));
    if (grid.style === 'dot') {
      const dot = document.createElementNS(SVG_NS, 'circle');
      dot.setAttribute('cx', '1');
      dot.setAttribute('cy', '1');
      dot.setAttribute('r', '1');
      dot.setAttribute('fill', grid.color);
      pattern.appendChild(dot);
    } else {
      const lines = document.createElementNS(SVG_NS, 'path');
      lines.setAttribute('d', `M ${spacing} 0 L 0 0 L 0 ${spacing}`);
      lines.setAttribute('fill', 'none');
      lines.setAttribute('stroke', grid.color);
      lines.setAttribute('stroke-width', '1');
      lines.setAttribute('shape-rendering', 'crispEdges');
      pattern.appendChild(lines);
    }
    const fill = document.createElementNS(SVG_NS, 'rect');
    fill.setAttribute('width', '100%');
    fill.setAttribute('height', '100%');
    fill.setAttribute('fill', `url(#${gridId})`);
    background.appendChild(pattern);
    background.appendChild(fill);
  };

  /** Rotation transform about the item's pivot (default: rect center). */
  const rotationTransform = (
    element: SVGElement,
    rect: { x: number; y: number; width: number; height: number },
    rotation: number,
    pivot?: Point,
  ): void => {
    if (rotation % 360 !== 0) {
      const cx = pivot?.x ?? rect.x + rect.width / 2;
      const cy = pivot?.y ?? rect.y + rect.height / 2;
      element.setAttribute('transform', `rotate(${rotation} ${cx} ${cy})`);
    } else {
      element.removeAttribute('transform');
    }
  };

  const applyItem = (element: SVGElement, item: RenderItem, lod: SceneFrame['lod']): void => {
    const { style } = item;
    let strokeWidth = style.strokeWidth;
    if (item.kind === 'shape') {
      switch (item.shape) {
        case 'ellipse':
          element.setAttribute('cx', String(item.rect.x + item.rect.width / 2));
          element.setAttribute('cy', String(item.rect.y + item.rect.height / 2));
          element.setAttribute('rx', String(item.rect.width / 2));
          element.setAttribute('ry', String(item.rect.height / 2));
          break;
        case 'polygon':
          element.setAttribute(
            'points',
            (item.points ?? []).map((p) => `${p.x},${p.y}`).join(' '),
          );
          break;
        case 'path':
          element.setAttribute('d', segmentData(item.segments ?? []));
          break;
        default:
          element.setAttribute('x', String(item.rect.x));
          element.setAttribute('y', String(item.rect.y));
          element.setAttribute('width', String(item.rect.width));
          element.setAttribute('height', String(item.rect.height));
          if (item.shape === 'roundRect') element.setAttribute('rx', String(item.radius ?? 0));
          else element.removeAttribute('rx');
      }
      element.setAttribute('fill', style.fill);
      rotationTransform(element, item.rect, item.rotation, item.pivot);
    } else if (item.kind === 'path') {
      element.setAttribute('d', pathData(item));
      element.setAttribute('fill', 'none');
      if ((options.edgeArrows ?? true) && lod === 'full') {
        element.setAttribute('marker-end', `url(#${markerId})`);
      } else {
        element.removeAttribute('marker-end');
      }
    } else if (item.kind === 'image') {
      element.setAttribute('href', item.href);
      element.setAttribute('x', String(item.rect.x));
      element.setAttribute('y', String(item.rect.y));
      element.setAttribute('width', String(item.rect.width));
      element.setAttribute('height', String(item.rect.height));
      element.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      rotationTransform(element, item.rect, item.rotation, item.pivot);
    } else if (item.kind === 'icon') {
      // ponytail: neutral plate + data-icon marker; real glyph resolution
      // needs a host icon registry (close-out / P11 territory).
      element.setAttribute('data-icon', item.icon);
      element.setAttribute('x', String(item.rect.x));
      element.setAttribute('y', String(item.rect.y));
      element.setAttribute('width', String(item.rect.width));
      element.setAttribute('height', String(item.rect.height));
      element.setAttribute('rx', '4');
      element.setAttribute('fill', style.fill);
      rotationTransform(element, item.rect, item.rotation, item.pivot);
    } else if (item.kind === 'port') {
      element.setAttribute('cx', String(item.center.x));
      element.setAttribute('cy', String(item.center.y));
      element.setAttribute('r', String(item.radius));
      element.setAttribute('fill', style.fill);
    } else if (item.kind === 'marker') {
      element.setAttribute('d', segmentData(item.segments));
      element.setAttribute(
        'transform',
        `translate(${item.at.x} ${item.at.y}) rotate(${item.angle}) scale(${item.size})`,
      );
      element.setAttribute('fill', item.filled ? style.fill : 'none');
      // Stroke width is applied inside the scaled marker space.
      strokeWidth = style.strokeWidth / item.size;
    } else {
      element.setAttribute('x', String(item.position.x));
      element.setAttribute('y', String(item.position.y));
      element.setAttribute('text-anchor', 'middle');
      element.setAttribute('dominant-baseline', 'central');
      element.setAttribute('font-family', style.fontFamily);
      element.setAttribute('font-size', String(style.fontSize));
      element.setAttribute('fill', style.textColor);
      if (style.bold === true) element.setAttribute('font-weight', 'bold');
      else element.removeAttribute('font-weight');
      element.textContent = item.text;
    }
    if (item.kind !== 'text') {
      // At dot LOD strokes are noise — fills alone read as a density map.
      if (lod === 'dot') element.removeAttribute('stroke');
      else {
        element.setAttribute('stroke', style.stroke);
        element.setAttribute('stroke-width', String(strokeWidth));
      }
      if (style.strokeDasharray !== undefined) {
        element.setAttribute('stroke-dasharray', style.strokeDasharray.join(' '));
      } else {
        element.removeAttribute('stroke-dasharray');
      }
    }
    if (style.opacity !== undefined) element.setAttribute('opacity', String(style.opacity));
    else element.removeAttribute('opacity');
  };

  const createElement = (item: RenderItem): SVGElement => {
    const element = document.createElementNS(SVG_NS, tagFor(item));
    element.setAttribute('data-item', item.id);
    return element;
  };

  /** Moves layer children only where DOM order disagrees with paint order. */
  const syncOrder = (layer: SVGGElement, desired: readonly SVGElement[]): void => {
    let cursor = layer.firstElementChild;
    for (const element of desired) {
      if (cursor === element) {
        cursor = cursor.nextElementSibling;
      } else {
        layer.insertBefore(element, cursor);
      }
    }
  };

  return {
    mount(host) {
      svg = document.createElementNS(SVG_NS, 'svg');
      svg.setAttribute('width', '100%');
      svg.setAttribute('height', '100%');
      svg.setAttribute('data-graphloom', 'svg');
      svg.style.display = 'block';

      const defs = document.createElementNS(SVG_NS, 'defs');
      const marker = document.createElementNS(SVG_NS, 'marker');
      marker.setAttribute('id', markerId);
      marker.setAttribute('viewBox', '0 0 8 8');
      marker.setAttribute('refX', '8');
      marker.setAttribute('refY', '4');
      marker.setAttribute('markerWidth', '7');
      marker.setAttribute('markerHeight', '7');
      marker.setAttribute('orient', 'auto-start-reverse');
      const arrow = document.createElementNS(SVG_NS, 'path');
      arrow.setAttribute('d', 'M 0 0 L 8 4 L 0 8 z');
      // ponytail: one marker in the default edge stroke color; per-style
      // markers arrive with P7 theming (defs management is in place).
      arrow.setAttribute('fill', '#8892a6');
      marker.appendChild(arrow);
      defs.appendChild(marker);
      svg.appendChild(defs);

      background = document.createElementNS(SVG_NS, 'g');
      background.setAttribute('data-layer', 'background');
      svg.appendChild(background);

      world = document.createElementNS(SVG_NS, 'g');
      world.setAttribute('data-layer', 'world');
      const edges = document.createElementNS(SVG_NS, 'g');
      edges.setAttribute('data-layer', 'edges');
      const nodes = document.createElementNS(SVG_NS, 'g');
      nodes.setAttribute('data-layer', 'nodes');
      world.appendChild(edges);
      world.appendChild(nodes);
      svg.appendChild(world);

      const overlay = document.createElementNS(SVG_NS, 'g');
      overlay.setAttribute('data-layer', 'overlay');
      svg.appendChild(overlay);

      layers = { edges, nodes };
      host.appendChild(svg);
    },

    render(frame) {
      if (!svg || !world || !layers) throw new Error('render() before mount()');
      const { x, y, zoom } = frame.viewport;
      world.setAttribute('transform', `translate(${x} ${y}) scale(${zoom})`);
      renderGrid(frame.viewport);

      for (const id of frame.dirty.removed) {
        elements.get(id)?.remove();
        elements.delete(id);
      }
      const itemById = new Map(frame.items.map((item) => [item.id, item] as const));
      for (const id of frame.dirty.added) {
        const item = itemById.get(id);
        if (!item) continue;
        const element = createElement(item);
        applyItem(element, item, frame.lod);
        elements.set(id, element);
        layers[item.layer].appendChild(element);
      }
      for (const id of frame.dirty.updated) {
        const item = itemById.get(id);
        let element = elements.get(id);
        if (!item || !element) continue;
        if (element.tagName !== tagFor(item)) {
          // The item changed geometry kind (e.g. a node re-typed rect →
          // diamond) — the SVG tag must change with it.
          const next = createElement(item);
          element.replaceWith(next);
          elements.set(id, next);
          element = next;
        }
        applyItem(element, item, frame.lod);
      }
      // Paint order: reorder only where the incremental patches broke it.
      for (const layer of ['edges', 'nodes'] as const) {
        syncOrder(
          layers[layer],
          frame.items
            .filter((item) => item.layer === layer)
            .map((item) => elements.get(item.id))
            .filter((element): element is SVGElement => element !== undefined),
        );
      }
      lastFrame = frame;
    },

    hitTest(point) {
      return hitTestFrame(lastFrame, point);
    },

    get grid() {
      return grid;
    },

    setGrid(config) {
      grid = { ...grid, ...config };
      if (lastFrame) renderGrid(lastFrame.viewport);
    },

    measureText(text: string, style: TextStyle): Size {
      return measure(text, style);
    },

    destroy() {
      svg?.remove();
      svg = null;
      world = null;
      background = null;
      layers = null;
      elements = new Map();
      lastFrame = null;
    },
  };
}
