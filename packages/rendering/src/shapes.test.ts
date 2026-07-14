import {
  createNode,
  DEFAULT_VISUAL_STATE,
  validateShapeSpec,
  type Node,
  type VisualState,
} from '@graphloom/core';
import { darkTheme, lightTheme } from '@graphloom/themes';
import { describe, expect, it } from 'vitest';
import { boundsOfPoints, rectsIntersect, type Rect } from './geometry.js';
import { builtinShapes, resolveShapeDescriptor, statePaint } from './shapes.js';
import { flattenSegments, lowerShapeSpec } from './spec.js';
import { estimateTextSize } from './text.js';

/** Every distinct library shape key (aliases collapse to the same descriptor). */
const SPEC_SHAPES = [
  'rectangle',
  'rounded-rectangle',
  'circle',
  'diamond',
  'triangle',
  'hexagon',
  'database',
  'queue',
  'cloud',
  'folder',
  'document',
  'person',
  'server',
  'api',
  'storage',
  'container',
  'image',
  'svg',
  'icon',
] as const;

const nodeOf = (type: string, width = 120, height = 80, extra: Record<string, unknown> = {}): Node =>
  createNode({ id: `n-${type}`, type, position: { x: 40, y: 30 }, size: { width, height }, ...extra });

/** World bounds of every lowered item of a node under a theme/state. */
const loweredBounds = (node: Node, state: VisualState = DEFAULT_VISUAL_STATE): Rect => {
  const spec = resolveShapeDescriptor(node.type)(node, lightTheme, state);
  const items = lowerShapeSpec(spec, {
    node,
    theme: lightTheme,
    element: 'node',
    elementId: node.id,
    layer: 'nodes',
    zIndex: 0,
    baseId: `node:${node.id}`,
    measure: estimateTextSize,
  });
  return items.map((i) => i.bounds).reduce((a, b) => boundsOfPoints([
    { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y) },
    { x: Math.max(a.x + a.width, b.x + b.width), y: Math.max(a.y + a.height, b.y + b.height) },
  ]));
};

describe('built-in shape library (P7-T02)', () => {
  it('covers every spec §Shape Library shape plus the legacy aliases', () => {
    for (const key of SPEC_SHAPES) expect(builtinShapes.has(key), key).toBe(true);
    expect(builtinShapes.get('default')).toBe(builtinShapes.get('rectangle'));
    expect(builtinShapes.get('ellipse')).toBe(builtinShapes.get('circle'));
    expect(builtinShapes.get('cylinder')).toBe(builtinShapes.get('database'));
  });

  it('every shape produces a valid spec with a11y fields and default anchors, in both themes', () => {
    for (const key of SPEC_SHAPES) {
      for (const theme of [lightTheme, darkTheme]) {
        const node = nodeOf(key);
        const spec = resolveShapeDescriptor(key)(node, theme, DEFAULT_VISUAL_STATE);
        expect(validateShapeSpec(spec), `${key} (${theme.name}): ${validateShapeSpec(spec).join('; ')}`).toEqual([]);
        expect(spec.role.length, key).toBeGreaterThan(0);
        expect(spec.label, key).toBe(key); // falls back to the type when unlabeled
        expect(spec.anchors?.length, key).toBeGreaterThanOrEqual(4);
      }
    }
  });

  it('every shape resizes correctly: geometry stays inside the node box at any size', () => {
    for (const key of SPEC_SHAPES) {
      for (const [w, h] of [
        [120, 80],
        [40, 200],
        [300, 24],
      ] as const) {
        const node = nodeOf(key, w, h);
        const bounds = loweredBounds(node);
        const box: Rect = { x: 40, y: 30, width: w, height: h };
        // Allow half the stroke width of slack on each side.
        expect(bounds.x, `${key} ${w}×${h}`).toBeGreaterThanOrEqual(box.x - 2);
        expect(bounds.y, `${key} ${w}×${h}`).toBeGreaterThanOrEqual(box.y - 2);
        expect(bounds.x + bounds.width, `${key} ${w}×${h}`).toBeLessThanOrEqual(box.x + box.width + 2);
        expect(bounds.y + bounds.height, `${key} ${w}×${h}`).toBeLessThanOrEqual(box.y + box.height + 2);
      }
    }
  });

  it('every shape rotates correctly: lowered bounds stay inside the rotated node bounds', () => {
    for (const key of SPEC_SHAPES) {
      const node = nodeOf(key, 120, 80, { rotation: 37 });
      const bounds = loweredBounds(node);
      // 120×80 rotated 37° about (100,70): the rotated AABB.
      const rad = (37 * Math.PI) / 180;
      const halfW = (120 * Math.abs(Math.cos(rad)) + 80 * Math.abs(Math.sin(rad))) / 2;
      const halfH = (120 * Math.abs(Math.sin(rad)) + 80 * Math.abs(Math.cos(rad))) / 2;
      expect(bounds.x, key).toBeGreaterThanOrEqual(100 - halfW - 2);
      expect(bounds.y, key).toBeGreaterThanOrEqual(70 - halfH - 2);
      expect(bounds.x + bounds.width, key).toBeLessThanOrEqual(100 + halfW + 2);
      expect(bounds.y + bounds.height, key).toBeLessThanOrEqual(70 + halfH + 2);
      // And the shape actually moved with the rotation (not axis-aligned only).
      expect(rectsIntersect(bounds, { x: 100 - 5, y: 70 - 5, width: 10, height: 10 }), key).toBe(true);
    }
  });

  it("triangle anchors sit on the sloped outline, not the bounding box (dynamic anchors)", () => {
    const node = nodeOf('triangle', 100, 100);
    const spec = resolveShapeDescriptor('triangle')(node, lightTheme, DEFAULT_VISUAL_STATE);
    const left = spec.anchors?.find((a) => a.id === 'left');
    expect(left?.position).toEqual({ x: 25, y: 50 }); // on the left slope
  });

  it('image/svg shapes use node data sources, placeholders otherwise', () => {
    const withSrc = resolveShapeDescriptor('image')(
      nodeOf('image', 100, 100, { data: { src: 'https://example.test/x.png' } }),
      lightTheme,
      DEFAULT_VISUAL_STATE,
    );
    expect(withSrc.children[0]).toMatchObject({ kind: 'image', href: 'https://example.test/x.png' });

    const inline = resolveShapeDescriptor('svg')(
      nodeOf('svg', 100, 100, { data: { svg: '<svg xmlns="http://www.w3.org/2000/svg"/>' } }),
      lightTheme,
      DEFAULT_VISUAL_STATE,
    );
    expect(inline.children[0]).toMatchObject({ kind: 'image' });
    expect((inline.children[0] as { href: string }).href).toMatch(/^data:image\/svg\+xml/);

    const placeholder = resolveShapeDescriptor('image')(nodeOf('image'), lightTheme, DEFAULT_VISUAL_STATE);
    expect(placeholder.children[0]).toMatchObject({ kind: 'rect' });
  });

  it('unknown types fall back to the rectangle descriptor; registries win over built-ins', () => {
    const fallback = resolveShapeDescriptor('no-such-shape');
    expect(fallback).toBe(builtinShapes.get('rectangle'));
    const custom = resolveShapeDescriptor('rectangle', new Map([['rectangle', builtinShapes.get('circle')!]]));
    expect(custom).toBe(builtinShapes.get('circle'));
  });

  it('database body flattens into sane closed geometry (arc cubics)', () => {
    const node = nodeOf('database', 100, 120);
    const spec = resolveShapeDescriptor('database')(node, lightTheme, DEFAULT_VISUAL_STATE);
    const body = spec.children[0];
    expect(body?.kind).toBe('path');
    if (body?.kind !== 'path') throw new Error('unreachable');
    const rings = flattenSegments(body.segments);
    expect(rings[0]?.length).toBeGreaterThan(30);
  });
});

describe('statePaint (P7-T08 visual states)', () => {
  const node = nodeOf('rectangle');
  const { tokens } = lightTheme;

  it('is the plain node paint at rest (pixel parity with pre-P7 defaults)', () => {
    expect(statePaint(node, lightTheme, DEFAULT_VISUAL_STATE)).toEqual({
      fill: tokens.nodeFill,
      stroke: tokens.nodeStroke,
      strokeWidth: tokens.nodeStrokeWidth,
    });
  });

  it('selection beats hover; dragging beats locked', () => {
    expect(statePaint(node, lightTheme, { selected: true, hovered: true, dragging: false })).toMatchObject({
      stroke: tokens.selectionStroke,
      strokeWidth: tokens.selectionStrokeWidth,
    });
    expect(statePaint(node, lightTheme, { selected: false, hovered: true, dragging: false })).toMatchObject({
      stroke: tokens.hoverStroke,
    });
    const locked = createNode({ type: 'rectangle', locked: true });
    expect(statePaint(locked, lightTheme, DEFAULT_VISUAL_STATE).opacity).toBe(tokens.lockedOpacity);
    expect(
      statePaint(locked, lightTheme, { selected: false, hovered: false, dragging: true }).opacity,
    ).toBe(tokens.draggingOpacity);
  });
});
