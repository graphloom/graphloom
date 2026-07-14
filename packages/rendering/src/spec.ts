// Lowers declarative ShapeSpec trees (ADR-0003 Tier 1, core vocabulary) into
// world-space render items (ADR-0002 scene vocabulary). This is the one place
// that understands both sides; renderers and hit tests only ever see items.
import type {
  Node,
  PathSegment,
  Point,
  ShapeSpec,
  SpecPrimitive,
  SpecStyle,
  SpecTextStyle,
  Theme,
} from '@graphloom/core';
import {
  applyToPoint,
  boundsOfPoints,
  compose,
  cubicBezierPoint,
  quadraticBezierPoint,
  rotationAbout,
  translation,
  type Mat2x3,
  type Rect,
} from './geometry.js';
import { ellipsize, LINE_HEIGHT, wrapText, type TextMeasurer } from './text.js';
import type {
  RenderItem,
  RenderItemId,
  ResolvedStyle,
  SceneElementKind,
  SceneLayer,
  TextRenderItem,
} from './scene.js';

/**
 * The local→world transform of a node: translate to `position`, then rotate
 * clockwise about the node center (P3 rotation semantics).
 */
export function nodeTransform(node: Node): Mat2x3 {
  const move = translation(node.position.x, node.position.y);
  if (node.rotation % 360 === 0) return move;
  return compose(
    rotationAbout(
      node.rotation,
      node.position.x + node.size.width / 2,
      node.position.y + node.size.height / 2,
    ),
    move,
  );
}

/** Applies a transform to every coordinate of a path segment list. */
export function transformSegments(
  segments: readonly PathSegment[],
  m: Mat2x3,
): PathSegment[] {
  const t = (p: Point): Point => applyToPoint(m, p);
  return segments.map((segment) => {
    switch (segment.kind) {
      case 'M':
      case 'L':
        return { kind: segment.kind, to: t(segment.to) };
      case 'C':
        return { kind: 'C', c1: t(segment.c1), c2: t(segment.c2), to: t(segment.to) };
      case 'Q':
        return { kind: 'Q', c: t(segment.c), to: t(segment.to) };
      case 'Z':
        return segment;
    }
  });
}

/**
 * Flattens path segments into polylines (one per subpath) for hit testing and
 * culling. Curves sample `curveSteps` points; `Z` closes the ring back to the
 * subpath start.
 */
export function flattenSegments(
  segments: readonly PathSegment[],
  curveSteps = 16,
): Point[][] {
  const subpaths: Point[][] = [];
  let current: Point[] = [];
  let start: Point | null = null;
  let cursor: Point = { x: 0, y: 0 };
  const push = (p: Point): void => {
    current.push(p);
    cursor = p;
  };
  for (const segment of segments) {
    switch (segment.kind) {
      case 'M':
        if (current.length > 1) subpaths.push(current);
        current = [];
        start = segment.to;
        push(segment.to);
        break;
      case 'L':
        push(segment.to);
        break;
      case 'C':
        for (let i = 1; i <= curveSteps; i++) {
          push(cubicBezierPoint(cursor, segment.c1, segment.c2, segment.to, i / curveSteps));
        }
        break;
      case 'Q':
        for (let i = 1; i <= curveSteps; i++) {
          push(quadraticBezierPoint(cursor, segment.c, segment.to, i / curveSteps));
        }
        break;
      case 'Z':
        if (start) push(start);
        break;
    }
  }
  if (current.length > 1) subpaths.push(current);
  return subpaths;
}

/** Every coordinate (endpoints and controls) of a segment list. */
function segmentPoints(segments: readonly PathSegment[]): Point[] {
  const points: Point[] = [];
  for (const segment of segments) {
    if (segment.kind === 'Z') continue;
    if (segment.kind === 'C') points.push(segment.c1, segment.c2);
    if (segment.kind === 'Q') points.push(segment.c);
    points.push(segment.to);
  }
  return points;
}

/**
 * The world position of a spec anchor on a node (P7-T03 dynamic per-shape
 * anchors): the local anchor point pushed through the node transform.
 */
export function specAnchorPoint(node: Node, position: Point): Point {
  return applyToPoint(nodeTransform(node), position);
}

/** What {@link lowerShapeSpec} needs besides the spec itself. */
export interface LowerContext {
  /** The node the spec describes (position/size/rotation/zIndex source). */
  readonly node: Node;
  readonly theme: Theme;
  /** Scene bookkeeping: which model element the items derive from. */
  readonly element: SceneElementKind;
  readonly elementId: string;
  readonly layer: SceneLayer;
  readonly zIndex: number;
  /** Root item id; extra primitives get `:{index}` suffixes. */
  readonly baseId: RenderItemId;
  readonly measure: TextMeasurer;
}

/** Resolves a primitive paint style over the theme's node defaults. */
function resolvePaint(style: SpecStyle | undefined, theme: Theme): ResolvedStyle {
  const { tokens } = theme;
  return {
    fill: style?.fill ?? tokens.nodeFill,
    stroke: style?.stroke ?? tokens.nodeStroke,
    strokeWidth: style?.strokeWidth ?? tokens.nodeStrokeWidth,
    fontFamily: tokens.fontFamily,
    fontSize: tokens.fontSize,
    textColor: tokens.nodeText,
    ...(style?.opacity !== undefined && { opacity: style.opacity }),
    ...(style?.strokeDasharray !== undefined && { strokeDasharray: style.strokeDasharray }),
  };
}

/** Resolves a text primitive style over the theme's node text defaults. */
function resolveText(style: SpecTextStyle | undefined, theme: Theme): ResolvedStyle {
  const { tokens } = theme;
  return {
    fill: 'none',
    stroke: 'none',
    strokeWidth: 0,
    fontFamily: style?.fontFamily ?? tokens.fontFamily,
    fontSize: style?.fontSize ?? tokens.fontSize,
    textColor: style?.color ?? tokens.nodeText,
    ...(style?.bold === true && { bold: true }),
  };
}

/** Axis-aligned bounds of a world rect rotated about an arbitrary pivot. */
function pivotedBounds(rect: Rect, rotation: number, pivot: Point): Rect {
  if (rotation % 360 === 0) return rect;
  const m = rotationAbout(rotation, pivot.x, pivot.y);
  return boundsOfPoints([
    applyToPoint(m, { x: rect.x, y: rect.y }),
    applyToPoint(m, { x: rect.x + rect.width, y: rect.y }),
    applyToPoint(m, { x: rect.x + rect.width, y: rect.y + rect.height }),
    applyToPoint(m, { x: rect.x, y: rect.y + rect.height }),
  ]);
}

/**
 * Lowers a {@link ShapeSpec} into render items in world space. Rect-like
 * primitives keep an unrotated rect + the node rotation (renderers apply the
 * transform); polygon/path/text geometry is baked. Unknown primitive kinds
 * are skipped (forward compatibility — see the P7-T01 API review).
 */
export function lowerShapeSpec(spec: ShapeSpec, ctx: LowerContext): RenderItem[] {
  const { node, theme } = ctx;
  const rotation = node.rotation % 360;
  const center: Point = {
    x: node.position.x + node.size.width / 2,
    y: node.position.y + node.size.height / 2,
  };
  const rotate = rotation === 0 ? null : rotationAbout(rotation, center.x, center.y);
  const items: RenderItem[] = [];
  let index = 0;

  const base = {
    element: ctx.element,
    elementId: ctx.elementId,
    layer: ctx.layer,
    zIndex: ctx.zIndex,
  } as const;
  const nextId = (): RenderItemId => {
    const id = index === 0 ? ctx.baseId : `${ctx.baseId}:${index}`;
    index++;
    return id;
  };
  // Rect-like items rotate about the NODE center, not their own — record the
  // pivot only when it differs from the rect center (root shapes match it,
  // which keeps pre-P7 item JSON byte-identical).
  const pivotOf = (rect: Rect): { pivot?: Point } => {
    if (rotation === 0) return {};
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    return cx === center.x && cy === center.y ? {} : { pivot: center };
  };

  const lower = (primitive: SpecPrimitive, offset: Point): void => {
    const dx = offset.x + node.position.x;
    const dy = offset.y + node.position.y;
    switch (primitive.kind) {
      case 'rect':
      case 'roundRect': {
        const rect: Rect = {
          x: primitive.x + dx,
          y: primitive.y + dy,
          width: primitive.width,
          height: primitive.height,
        };
        const pivot = pivotOf(rect);
        items.push({
          id: nextId(),
          kind: 'shape',
          shape: primitive.kind,
          ...base,
          rect,
          rotation,
          ...pivot,
          ...(primitive.kind === 'roundRect' && {
            radius: Math.min(primitive.radius, primitive.width / 2, primitive.height / 2),
          }),
          bounds: pivotedBounds(rect, rotation, pivot.pivot ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }),
          style: resolvePaint(primitive.style, theme),
        });
        break;
      }
      case 'ellipse': {
        const rect: Rect = {
          x: primitive.cx - primitive.rx + dx,
          y: primitive.cy - primitive.ry + dy,
          width: primitive.rx * 2,
          height: primitive.ry * 2,
        };
        const pivot = pivotOf(rect);
        items.push({
          id: nextId(),
          kind: 'shape',
          shape: 'ellipse',
          ...base,
          rect,
          rotation,
          ...pivot,
          bounds: pivotedBounds(rect, rotation, pivot.pivot ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }),
          style: resolvePaint(primitive.style, theme),
        });
        break;
      }
      case 'polygon': {
        const move = translation(dx, dy);
        const m = rotate ? compose(rotate, move) : move;
        const points = primitive.points.map((p) => applyToPoint(m, p));
        items.push({
          id: nextId(),
          kind: 'shape',
          shape: 'polygon',
          ...base,
          rect: boundsOfPoints(points),
          rotation: 0, // baked into the points
          points,
          bounds: boundsOfPoints(points),
          style: resolvePaint(primitive.style, theme),
        });
        break;
      }
      case 'path': {
        const move = translation(dx, dy);
        const m = rotate ? compose(rotate, move) : move;
        const segments = transformSegments(primitive.segments, m);
        const bounds = boundsOfPoints(segmentPoints(segments));
        items.push({
          id: nextId(),
          kind: 'shape',
          shape: 'path',
          ...base,
          rect: bounds,
          rotation: 0, // baked into the segments
          segments,
          bounds,
          style: resolvePaint(primitive.style, theme),
        });
        break;
      }
      case 'text': {
        const style = resolveText(primitive.style, theme);
        const move = translation(dx, dy);
        const m = rotate ? compose(rotate, move) : move;
        const at = applyToPoint(m, { x: primitive.x, y: primitive.y });
        const textStyle = { fontFamily: style.fontFamily, fontSize: style.fontSize };
        const lines =
          primitive.overflow === 'wrap' && primitive.maxWidth !== undefined
            ? wrapText(primitive.text, primitive.maxWidth, textStyle, ctx.measure)
            : primitive.overflow === 'ellipsis' && primitive.maxWidth !== undefined
              ? [ellipsize(primitive.text, primitive.maxWidth, textStyle, ctx.measure)]
              : [primitive.text];
        const idBase = nextId();
        const lineHeight = LINE_HEIGHT * style.fontSize;
        const top = at.y - (lines.length * lineHeight) / 2;
        lines.forEach((line, lineIndex) => {
          if (line === '') return;
          const size = ctx.measure(line, textStyle);
          const position = { x: at.x, y: top + lineHeight * (lineIndex + 0.5) };
          const item: TextRenderItem = {
            id: lineIndex === 0 ? idBase : `${idBase}:l${lineIndex}`,
            kind: 'text',
            ...base,
            text: line,
            position,
            bounds: {
              x: position.x - size.width / 2,
              y: position.y - size.height / 2,
              width: size.width,
              height: size.height,
            },
            style,
          };
          items.push(item);
        });
        break;
      }
      case 'image':
      case 'icon': {
        const rect: Rect =
          primitive.kind === 'image'
            ? { x: primitive.x + dx, y: primitive.y + dy, width: primitive.width, height: primitive.height }
            : { x: primitive.x + dx, y: primitive.y + dy, width: primitive.size, height: primitive.size };
        const pivot = pivotOf(rect);
        items.push({
          id: nextId(),
          kind: primitive.kind,
          ...(primitive.kind === 'image' ? { href: primitive.href } : { icon: primitive.icon }),
          ...base,
          rect,
          rotation,
          ...pivot,
          bounds: pivotedBounds(rect, rotation, pivot.pivot ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 }),
          style: resolvePaint(primitive.style, theme),
        } as RenderItem);
        break;
      }
      case 'group':
        for (const child of primitive.children) {
          lower(child, {
            x: offset.x + (primitive.translate?.x ?? 0),
            y: offset.y + (primitive.translate?.y ?? 0),
          });
        }
        break;
      default:
        // Unknown primitive kind from a newer vocabulary minor — skip it.
        break;
    }
  };

  for (const child of spec.children) lower(child, { x: 0, y: 0 });
  return items;
}
