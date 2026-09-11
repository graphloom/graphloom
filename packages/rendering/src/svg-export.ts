import type { GraphEditor, Point, Theme } from '@graphloom/core';
import { lightTheme } from '@graphloom/themes';
import { inflateRect, rectsIntersect, type Rect } from './geometry.js';
import { pathData, segmentData } from './path-data.js';
import { SceneGraph, type RenderItem } from './scene.js';

/** Options for {@link exportSvg}. */
export interface SvgExportOptions {
  /** Theme to resolve styles against (default: the built-in light theme). */
  readonly theme?: Theme;
  /**
   * World-space rect to export ("viewport crop"). Default: the whole graph's
   * bounds, grown by `padding`. Items entirely outside it are omitted.
   */
  readonly bounds?: Rect;
  /** World-unit margin added around the full-graph bounds. Ignored when `bounds` is given. Default 40. */
  readonly padding?: number;
  /**
   * Background rect fill. Default: the theme's `background` token. `null`
   * omits the background rect entirely (transparent).
   */
  readonly background?: string | null;
}

const XML_ESCAPES: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escapeXml = (value: string): string => value.replace(/[&<>"]/g, (c) => XML_ESCAPES[c]!);

type AttrValue = string | number | undefined;

const attrString = (attrs: Record<string, AttrValue>): string =>
  Object.entries(attrs)
    .filter((entry): entry is [string, string | number] => entry[1] !== undefined)
    .map(([key, value]) => `${key}="${escapeXml(String(value))}"`)
    .join(' ');

/** Renders one self-closing (or text-bearing) SVG element as a string. */
const tag = (name: string, attrs: Record<string, AttrValue>, text?: string): string => {
  const rendered = attrString(attrs);
  const open = rendered === '' ? `<${name}` : `<${name} ${rendered}`;
  return text === undefined ? `${open}/>` : `${open}>${escapeXml(text)}</${name}>`;
};

/** Renders the root `<svg ...>` opening tag (never self-closing — it always has children). */
const openTag = (attrs: Record<string, AttrValue>): string => `<svg ${attrString(attrs)}>`;

/** Rotation transform about the item's pivot (default: rect center) — matches the live SVG backend. */
const rotateTransform = (rect: Rect, rotation: number, pivot: Point | undefined): string | undefined => {
  if (rotation % 360 === 0) return undefined;
  const cx = pivot?.x ?? rect.x + rect.width / 2;
  const cy = pivot?.y ?? rect.y + rect.height / 2;
  return `rotate(${rotation} ${cx} ${cy})`;
};

/**
 * Renders one {@link RenderItem} to an SVG element string. Always at full
 * fidelity — a static document has no viewport-dependent LOD to drop, unlike
 * the live backends — and never emits the SVG-only presentation extras (grid,
 * default edge arrowhead) that aren't part of the `Renderer` contract, so the
 * output matches what the Canvas backend draws (this task's acceptance).
 */
const renderItem = (item: RenderItem): string => {
  const { style } = item;
  const dash = style.strokeDasharray?.join(' ');
  switch (item.kind) {
    case 'shape': {
      const base: Record<string, AttrValue> = {
        'data-item': item.id,
        fill: style.fill,
        stroke: style.stroke,
        'stroke-width': style.strokeWidth,
        'stroke-dasharray': dash,
        opacity: style.opacity,
        transform: rotateTransform(item.rect, item.rotation, item.pivot),
      };
      switch (item.shape) {
        case 'ellipse':
          return tag('ellipse', {
            ...base,
            cx: item.rect.x + item.rect.width / 2,
            cy: item.rect.y + item.rect.height / 2,
            rx: item.rect.width / 2,
            ry: item.rect.height / 2,
          });
        case 'polygon':
          return tag('polygon', {
            ...base,
            points: (item.points ?? []).map((p) => `${p.x},${p.y}`).join(' '),
          });
        case 'path':
          return tag('path', { ...base, d: segmentData(item.segments ?? []) });
        case 'roundRect':
          return tag('rect', {
            ...base,
            x: item.rect.x,
            y: item.rect.y,
            width: item.rect.width,
            height: item.rect.height,
            rx: item.radius ?? 0,
          });
        default:
          return tag('rect', {
            ...base,
            x: item.rect.x,
            y: item.rect.y,
            width: item.rect.width,
            height: item.rect.height,
          });
      }
    }
    case 'path':
      return tag('path', {
        'data-item': item.id,
        d: pathData(item),
        fill: 'none',
        stroke: style.stroke,
        'stroke-width': style.strokeWidth,
        'stroke-dasharray': dash,
        opacity: style.opacity,
      });
    case 'text':
      return tag(
        'text',
        {
          'data-item': item.id,
          x: item.position.x,
          y: item.position.y,
          'text-anchor': 'middle',
          'dominant-baseline': 'central',
          'font-family': style.fontFamily,
          'font-size': style.fontSize,
          'font-weight': style.bold === true ? 'bold' : undefined,
          fill: style.textColor,
          opacity: style.opacity,
        },
        item.text,
      );
    case 'image':
      return tag('image', {
        'data-item': item.id,
        href: item.href,
        x: item.rect.x,
        y: item.rect.y,
        width: item.rect.width,
        height: item.rect.height,
        preserveAspectRatio: 'xMidYMid meet',
        transform: rotateTransform(item.rect, item.rotation, item.pivot),
        opacity: style.opacity,
      });
    case 'icon':
      // ponytail: neutral rounded plate, matching the SVG/Canvas backends —
      // real glyph resolution needs a host icon registry (P11 territory).
      return tag('rect', {
        'data-item': item.id,
        'data-icon': item.icon,
        x: item.rect.x,
        y: item.rect.y,
        width: item.rect.width,
        height: item.rect.height,
        rx: 4,
        fill: style.fill,
        stroke: style.stroke,
        'stroke-width': style.strokeWidth,
        transform: rotateTransform(item.rect, item.rotation, item.pivot),
        opacity: style.opacity,
      });
    case 'port':
      return tag('circle', {
        'data-item': item.id,
        cx: item.center.x,
        cy: item.center.y,
        r: item.radius,
        fill: style.fill,
        stroke: style.stroke,
        'stroke-width': style.strokeWidth,
        opacity: style.opacity,
      });
    case 'marker':
      return tag('path', {
        'data-item': item.id,
        d: segmentData(item.segments),
        transform: `translate(${item.at.x} ${item.at.y}) rotate(${item.angle}) scale(${item.size})`,
        fill: item.filled ? style.fill : 'none',
        stroke: style.stroke,
        // Stroke width/dash are applied inside the scaled marker space (matches SVG/Canvas).
        'stroke-width': style.strokeWidth / item.size,
        'stroke-dasharray': style.strokeDasharray?.map((v) => v / item.size).join(' '),
        opacity: style.opacity,
      });
  }
};

const FALLBACK_BOUNDS: Rect = { x: 0, y: 0, width: 400, height: 300 };
const DEFAULT_PADDING = 40;

/**
 * Renders a graph to a standalone SVG document — from the scene graph
 * directly, not a live renderer (ADR-0002; this works in Node, no DOM
 * required). Styles are already theme-resolved literals (P7-T01: descriptors
 * bake tokens into specs, never CSS variables), so the document needs no
 * external stylesheet; text carries its `font-family` for the same reason.
 * Selection chrome, guides, the background grid and the default edge
 * arrowhead are never part of the scene graph's own output, so excluding
 * them (this task's acceptance) needs no special-casing here.
 */
export function exportSvg(editor: GraphEditor, options: SvgExportOptions = {}): string {
  const theme = options.theme ?? lightTheme;
  const scene = new SceneGraph(editor, { theme });
  try {
    const full = scene.bounds();
    const viewBox =
      options.bounds ?? (full ? inflateRect(full, options.padding ?? DEFAULT_PADDING) : FALLBACK_BOUNDS);
    const items = scene.items().filter((item) => rectsIntersect(item.bounds, viewBox));
    const background = options.background === undefined ? theme.tokens.background : options.background;

    const lines = [
      '<?xml version="1.0" encoding="UTF-8"?>',
      openTag({
        xmlns: 'http://www.w3.org/2000/svg',
        viewBox: `${viewBox.x} ${viewBox.y} ${viewBox.width} ${viewBox.height}`,
        width: viewBox.width,
        height: viewBox.height,
        'data-graphloom': 'svg-export',
      }),
    ];
    if (background !== null) {
      lines.push(
        tag('rect', {
          x: viewBox.x,
          y: viewBox.y,
          width: viewBox.width,
          height: viewBox.height,
          fill: background,
        }),
      );
    }
    for (const item of items) lines.push(renderItem(item));
    lines.push('</svg>');
    return `${lines.join('\n')}\n`;
  } finally {
    scene.destroy();
  }
}
