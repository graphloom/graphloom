import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { cubicBezierPoint, rectsIntersect, type Rect } from './geometry.js';
import { SceneGraph } from './scene.js';
import { hitTestItem, SpatialIndex } from './spatial.js';
import { ViewportController } from './viewport.js';

const addNode = (
  editor: GraphEditor,
  id: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): void => {
  editor.execute(
    commands.nodeAdd({ id, position: { x, y }, size: { width: 100, height: 40 }, ...extra }),
  );
};

const setup = (): { editor: GraphEditor; scene: SceneGraph; index: SpatialIndex } => {
  const editor = createGraph();
  const scene = new SceneGraph(editor);
  return { editor, scene, index: new SpatialIndex(scene) };
};

describe('SpatialIndex hit testing', () => {
  it('returns null / empty on an empty scene', () => {
    const { index } = setup();
    expect(index.hitTest({ x: 0, y: 0 })).toBeNull();
    expect(index.hitTestAll({ x: 0, y: 0 })).toEqual([]);
  });

  it('resolves overlapping nodes top-most-by-z first', () => {
    const { editor, index } = setup();
    addNode(editor, 'under', 0, 0, { zIndex: 1 });
    addNode(editor, 'over', 50, 20, { zIndex: 2 });
    expect(index.hitTest({ x: 60, y: 30 })?.id).toBe('node:over');
    expect(index.hitTestAll({ x: 60, y: 30 }).map((i) => i.id)).toEqual([
      'node:over',
      'node:under',
    ]);
    expect(index.hitTest({ x: 10, y: 10 })?.id).toBe('node:under');
    expect(index.hitTest({ x: 500, y: 500 })).toBeNull();
  });

  it('nodes beat their underlying edges at the same point', () => {
    const { editor, index } = setup();
    addNode(editor, 'a', 0, 0);
    addNode(editor, 'b', 200, 0);
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b', zIndex: 9 }));
    // Node centers anchor the edge, so the source center hits both; the node
    // wins even at lower zIndex because the nodes layer paints above edges.
    expect(index.hitTest({ x: 50, y: 20 })?.id).toBe('node:a');
    // Between the nodes only the edge is hittable.
    expect(index.hitTest({ x: 150, y: 20 })?.id).toBe('edge:e');
  });

  it('edges are hit within tolerance of their path, straight and bezier', () => {
    const { editor, index } = setup();
    addNode(editor, 's', 0, 0);
    addNode(editor, 't', 300, 200);
    editor.execute(commands.edgeAdd({ id: 'line', source: 's', target: 't' }));
    editor.execute(
      commands.edgeAdd({ id: 'curve', source: 's', target: 't', routing: 'bezier', zIndex: 1 }),
    );
    const scene = index.hitTest({ x: 150, y: 200 }); // far from both paths
    expect(scene).toBeNull();

    // Both paths cross at the shared midpoint (200,120); the higher-z curve wins.
    expect(index.hitTest({ x: 200, y: 120 }, { tolerance: 1 })?.id).toBe('edge:curve');
    // Near the straight line but ~28 world units from the curve → line only.
    expect(index.hitTest({ x: 139, y: 82 }, { tolerance: 5 })?.id).toBe('edge:line');
    expect(index.hitTest({ x: 139, y: 82 })).toBeNull(); // ~3px off, no tolerance

    // Bézier midpoint via the actual control points.
    const mid = cubicBezierPoint(
      { x: 50, y: 20 },
      { x: 200, y: 20 },
      { x: 200, y: 220 },
      { x: 350, y: 220 },
      0.5,
    );
    expect(index.hitTest(mid, { tolerance: 2 })?.id).toBe('edge:curve');
  });

  it('respects rotation: precise hits differ from bounding boxes', () => {
    const { editor, index } = setup();
    // 100×40 at origin rotated 90° about (50,20): occupies x∈[30,70], y∈[-30,70].
    addNode(editor, 'r', 0, 0, { rotation: 90 });
    expect(index.hitTest({ x: 50, y: -20 })?.id).toBe('node:r'); // inside rotated
    expect(index.hitTest({ x: 5, y: 20 })).toBeNull(); // inside unrotated rect only
  });

  it('respects ellipse shape: corners of the rect miss', () => {
    const { editor, index } = setup();
    addNode(editor, 'e', 0, 0, { type: 'ellipse', size: { width: 100, height: 100 } });
    expect(index.hitTest({ x: 50, y: 50 })?.id).toBe('node:e');
    expect(index.hitTest({ x: 8, y: 8 })).toBeNull(); // inside bounds, outside ellipse
  });

  it('hits labels as text items and supports filters', () => {
    const { editor, index } = setup();
    addNode(editor, 'a', 0, 0, { data: { label: 'Hello' } });
    const all = index.hitTestAll({ x: 50, y: 20 });
    expect(all.map((i) => i.id)).toEqual(['label:node:a', 'node:a']);
    expect(
      index.hitTest({ x: 50, y: 20 }, { filter: (item) => item.kind !== 'text' })?.id,
    ).toBe('node:a');
  });

  it('hit results are identical at any zoom (world-space invariance)', () => {
    const { editor, index } = setup();
    addNode(editor, 'a', 100, 100);
    const world = { x: 150, y: 120 };
    const results = [0.1, 0.5, 1, 2, 8].map((zoom) => {
      const vp = new ViewportController({ size: { width: 800, height: 600 } });
      vp.setViewport({ x: -37, y: 11, zoom });
      const roundTripped = vp.screenToWorld(vp.worldToScreen(world));
      return index.hitTest(roundTripped)?.id;
    });
    expect(new Set(results)).toEqual(new Set(['node:a']));
  });

  it('hitTestItem covers stroke tolerance on shapes', () => {
    const { editor, scene } = setup();
    addNode(editor, 'a', 0, 0);
    const item = scene.get('node:a');
    expect(item && hitTestItem(item, { x: -0.5, y: 20 })).toBe(true); // half stroke (0.75)
    expect(item && hitTestItem(item, { x: -3, y: 20 })).toBe(false);
    expect(item && hitTestItem(item, { x: -3, y: 20 }, 3)).toBe(true);
  });
});

describe('SpatialIndex region queries and consistency (fuzz)', () => {
  const smallOp = fc.oneof(
    fc.record({
      op: fc.constant('add' as const),
      x: fc.integer({ min: -400, max: 400 }),
      y: fc.integer({ min: -400, max: 400 }),
      w: fc.integer({ min: 1, max: 150 }),
      h: fc.integer({ min: 1, max: 150 }),
      rotation: fc.constantFrom(0, 30, 90, 200),
      z: fc.integer({ min: -2, max: 2 }),
    }),
    fc.record({
      op: fc.constant('move' as const),
      pick: fc.nat(),
      x: fc.integer({ min: -400, max: 400 }),
      y: fc.integer({ min: -400, max: 400 }),
    }),
    fc.record({ op: fc.constant('remove' as const), pick: fc.nat() }),
    fc.record({ op: fc.constant('connect' as const), pickA: fc.nat(), pickB: fc.nat() }),
  );

  it('query(rect) matches a brute-force scan under add/move/remove fuzz', () => {
    let nextId = 0;
    fc.assert(
      fc.property(
        fc.array(smallOp, { minLength: 1, maxLength: 30 }),
        fc.record({
          x: fc.integer({ min: -500, max: 300 }),
          y: fc.integer({ min: -500, max: 300 }),
          width: fc.integer({ min: 0, max: 600 }),
          height: fc.integer({ min: 0, max: 600 }),
        }),
        (ops, region: Rect) => {
          const { editor, scene, index } = setup();
          for (const op of ops) {
            const nodes = editor.graph.nodes();
            const edges = editor.graph.edges();
            if (op.op === 'add') {
              editor.execute(
                commands.nodeAdd({
                  id: `n${nextId++}`,
                  position: { x: op.x, y: op.y },
                  size: { width: op.w, height: op.h },
                  rotation: op.rotation,
                  zIndex: op.z,
                }),
              );
            } else if (op.op === 'move' && nodes.length > 0) {
              const node = nodes[op.pick % nodes.length];
              if (node) {
                editor.execute(
                  commands.nodeUpdate(node.id, { position: { x: op.x, y: op.y } }),
                );
              }
            } else if (op.op === 'remove' && nodes.length > 0) {
              const node = nodes[op.pick % nodes.length];
              if (node) editor.execute(commands.nodeRemove(node.id));
            } else if (op.op === 'connect' && nodes.length > 1) {
              const a = nodes[op.pickA % nodes.length];
              const b = nodes[op.pickB % nodes.length];
              if (a && b) {
                editor.execute(
                  commands.edgeAdd({ id: `e${nextId++}`, source: a.id, target: b.id }),
                );
              }
            }
            void edges;
            // Query mid-sequence too: the lazy rebuild must track every state.
            const expected = scene.items().filter((item) => rectsIntersect(item.bounds, region));
            expect(index.query(region)).toEqual(expected);
          }
        },
      ),
      { numRuns: 40 },
    );
  });
});
