import { createNode, type ShapeSpec } from '@graphloom/core';
import { lightTheme } from '@graphloom/themes';
import { describe, expect, it } from 'vitest';
import { flattenSegments, lowerShapeSpec, nodeTransform, specAnchorPoint, transformSegments } from './spec.js';
import { applyToPoint } from './geometry.js';
import { estimateTextSize } from './text.js';
import type { LowerContext } from './spec.js';
import type { ShapeRenderItem, TextRenderItem } from './scene.js';

const ctxFor = (node: Parameters<typeof lowerShapeSpec>[1]['node']): LowerContext => ({
  node,
  theme: lightTheme,
  element: 'node',
  elementId: node.id,
  layer: 'nodes',
  zIndex: node.zIndex,
  baseId: `node:${node.id}`,
  measure: estimateTextSize,
});

describe('lowerShapeSpec', () => {
  const node = createNode({ id: 'n', position: { x: 100, y: 50 }, size: { width: 80, height: 40 } });

  it('assigns the root id to the first primitive and :index suffixes after', () => {
    const spec: ShapeSpec = {
      role: 'node',
      label: 'n',
      children: [
        { kind: 'rect', x: 0, y: 0, width: 80, height: 40 },
        { kind: 'ellipse', cx: 40, cy: 20, rx: 5, ry: 5 },
      ],
    };
    const items = lowerShapeSpec(spec, ctxFor(node));
    expect(items.map((i) => i.id)).toEqual(['node:n', 'node:n:1']);
  });

  it('translates local geometry into world space', () => {
    const items = lowerShapeSpec(
      {
        role: 'node',
        label: 'n',
        children: [
          { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 80, y: 0 }, { x: 40, y: 40 }] },
        ],
      },
      ctxFor(node),
    );
    expect((items[0] as ShapeRenderItem).points).toEqual([
      { x: 100, y: 50 },
      { x: 180, y: 50 },
      { x: 140, y: 90 },
    ]);
  });

  it('bakes node rotation into polygons/paths and pivots rect-likes about the node center', () => {
    const rotated = createNode({
      id: 'r',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      rotation: 90,
    });
    const items = lowerShapeSpec(
      {
        role: 'node',
        label: 'r',
        children: [
          { kind: 'rect', x: 0, y: 0, width: 100, height: 40 }, // root: pivot = own center
          { kind: 'rect', x: 0, y: 0, width: 10, height: 10 }, // corner chip: pivot = node center
          { kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 0, y: 10 }] },
        ],
      },
      ctxFor(rotated),
    );
    const [root, chip, polygon] = items as [ShapeRenderItem, ShapeRenderItem, ShapeRenderItem];
    expect(root.pivot).toBeUndefined(); // matches the node center → omitted
    expect(root.rotation).toBe(90);
    expect(chip.pivot).toEqual({ x: 50, y: 20 });
    // Polygon rotation is baked: local (0,0) rotated 90° about (50,20) → (70,-30).
    expect(polygon.rotation).toBe(0);
    expect(polygon.points?.[0]?.x).toBeCloseTo(70);
    expect(polygon.points?.[0]?.y).toBeCloseTo(-30);
  });

  it('wraps and ellipsizes text into per-line items via the text service', () => {
    const wrap = lowerShapeSpec(
      {
        role: 'node',
        label: 'n',
        children: [
          { kind: 'text', text: 'alpha beta gamma delta', x: 40, y: 20, maxWidth: 45, overflow: 'wrap' },
        ],
      },
      ctxFor(node),
    );
    expect(wrap.length).toBeGreaterThan(1);
    expect(wrap.map((i) => i.id)).toEqual(wrap.map((_, k) => (k === 0 ? 'node:n' : `node:n:l${k}`)));
    const [first, second] = wrap as [TextRenderItem, TextRenderItem];
    expect(second.position.y - first.position.y).toBeCloseTo(1.2 * lightTheme.tokens.fontSize);

    const ellipsis = lowerShapeSpec(
      {
        role: 'node',
        label: 'n',
        children: [
          { kind: 'text', text: 'an extremely long single line', x: 40, y: 20, maxWidth: 40, overflow: 'ellipsis' },
        ],
      },
      ctxFor(node),
    );
    expect(ellipsis).toHaveLength(1);
    expect((ellipsis[0] as TextRenderItem).text.endsWith('…')).toBe(true);
  });

  it('applies group translate recursively and skips unknown primitive kinds', () => {
    const items = lowerShapeSpec(
      {
        role: 'node',
        label: 'n',
        children: [
          {
            kind: 'group',
            translate: { x: 10, y: 10 },
            children: [
              { kind: 'group', translate: { x: 5, y: 0 }, children: [{ kind: 'rect', x: 0, y: 0, width: 4, height: 4 }] },
            ],
          },
          { kind: 'wobble' } as never, // future vocabulary minor → ignored
        ],
      },
      ctxFor(node),
    );
    expect(items).toHaveLength(1);
    expect((items[0] as ShapeRenderItem).rect).toEqual({ x: 115, y: 60, width: 4, height: 4 });
  });

  it('resolves primitive styles over theme tokens', () => {
    const items = lowerShapeSpec(
      {
        role: 'node',
        label: 'n',
        children: [
          { kind: 'rect', x: 0, y: 0, width: 8, height: 8 },
          { kind: 'rect', x: 0, y: 0, width: 8, height: 8, style: { fill: 'red', opacity: 0.5, strokeDasharray: [2, 2] } },
        ],
      },
      ctxFor(node),
    );
    expect(items[0]?.style).toMatchObject({
      fill: lightTheme.tokens.nodeFill,
      stroke: lightTheme.tokens.nodeStroke,
      strokeWidth: lightTheme.tokens.nodeStrokeWidth,
    });
    expect(items[0]?.style.opacity).toBeUndefined();
    expect(items[1]?.style).toMatchObject({ fill: 'red', opacity: 0.5, strokeDasharray: [2, 2] });
  });
});

describe('segment helpers', () => {
  it('transformSegments maps every coordinate kind', () => {
    const m = nodeTransform(createNode({ position: { x: 10, y: 20 }, size: { width: 10, height: 10 } }));
    const out = transformSegments(
      [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: 1, y: 1 } },
        { kind: 'Q', c: { x: 2, y: 0 }, to: { x: 3, y: 1 } },
        { kind: 'C', c1: { x: 4, y: 0 }, c2: { x: 5, y: 1 }, to: { x: 6, y: 0 } },
        { kind: 'Z' },
      ],
      m,
    );
    expect(out[0]).toEqual({ kind: 'M', to: { x: 10, y: 20 } });
    expect(out[2]).toEqual({ kind: 'Q', c: { x: 12, y: 20 }, to: { x: 13, y: 21 } });
    expect(out[4]).toEqual({ kind: 'Z' });
  });

  it('flattenSegments produces closed rings per subpath and samples curves', () => {
    const rings = flattenSegments([
      { kind: 'M', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: 10, y: 0 } },
      { kind: 'Z' },
      { kind: 'M', to: { x: 20, y: 0 } },
      { kind: 'C', c1: { x: 25, y: 10 }, c2: { x: 35, y: 10 }, to: { x: 40, y: 0 } },
    ]);
    expect(rings).toHaveLength(2);
    expect(rings[0]?.[rings[0].length - 1]).toEqual({ x: 0, y: 0 }); // Z closes
    expect(rings[1]?.length).toBeGreaterThan(10); // curve sampled
  });

  it('specAnchorPoint pushes local anchors through the node transform', () => {
    const rotated = createNode({
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      rotation: 180,
    });
    const world = specAnchorPoint(rotated, { x: 0, y: 0 });
    expect(world.x).toBeCloseTo(100);
    expect(world.y).toBeCloseTo(40);
    // Sanity: identical to applying nodeTransform directly.
    const direct = applyToPoint(nodeTransform(rotated), { x: 0, y: 0 });
    expect(world).toEqual(direct);
  });
});
