import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { SceneGraph, edgeAnchor, type RenderItem, type RenderItemId } from './scene.js';

const addNode = (
  editor: GraphEditor,
  id: string,
  x = 0,
  y = 0,
  extra: Record<string, unknown> = {},
): void => {
  editor.execute(
    commands.nodeAdd({ id, position: { x, y }, size: { width: 100, height: 40 }, ...extra }),
  );
};

describe('SceneGraph derivation', () => {
  it('derives a shape item per node and a text item per label', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a', 10, 20);
    addNode(editor, 'b', 200, 0, { data: { label: 'Node B' }, type: 'ellipse' });

    const items = scene.items();
    expect(items.map((i) => i.id)).toEqual(['node:a', 'node:b', 'label:node:b']);
    const shapeA = scene.get('node:a');
    expect(shapeA).toMatchObject({
      kind: 'shape',
      shape: 'rect',
      layer: 'nodes',
      rect: { x: 10, y: 20, width: 100, height: 40 },
      bounds: { x: 10, y: 20, width: 100, height: 40 },
    });
    expect(scene.get('node:b')).toMatchObject({ kind: 'shape', shape: 'ellipse' });
    const label = scene.get('label:node:b');
    expect(label).toMatchObject({ kind: 'text', text: 'Node B', position: { x: 250, y: 20 } });
  });

  it('rotated nodes get rotation-aware bounds', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a', 0, 0, { rotation: 90 });
    const item = scene.get('node:a');
    expect(item?.kind).toBe('shape');
    // 100×40 rotated 90° about center (50,20) → x∈[30,70], y∈[-30,50].
    expect(item?.bounds.x).toBeCloseTo(30);
    expect(item?.bounds.y).toBeCloseTo(-30);
    expect(item?.bounds.width).toBeCloseTo(40);
    expect(item?.bounds.height).toBeCloseTo(100);
  });

  it('derives edge paths per routing, anchored at centers or ports', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a', 0, 0, { ports: [{ id: 'out', side: 'right', offset: 0.5 }] });
    addNode(editor, 'b', 300, 100);
    editor.execute(commands.edgeAdd({ id: 'e1', source: 'a', target: 'b' }));
    editor.execute(
      commands.edgeAdd({
        id: 'e2',
        source: 'a',
        target: 'b',
        sourcePort: 'out',
        routing: 'orthogonal',
        labels: [{ text: 'mid', position: 0.5 }],
      }),
    );

    const e1 = scene.get('edge:e1');
    expect(e1).toMatchObject({
      kind: 'path',
      layer: 'edges',
      routing: 'straight',
      points: [
        { x: 50, y: 20 },
        { x: 350, y: 120 },
      ],
    });
    const e2 = scene.get('edge:e2');
    expect(e2).toMatchObject({
      kind: 'path',
      routing: 'orthogonal',
      points: [
        { x: 100, y: 20 }, // right side, offset 0.5
        { x: 225, y: 20 },
        { x: 225, y: 120 },
        { x: 350, y: 120 },
      ],
    });
    expect(scene.get('label:edge:e2:0')).toMatchObject({ kind: 'text', text: 'mid' });
  });

  it('edgeAnchor respects node rotation', () => {
    const node = {
      id: 'n',
      type: 'default',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      rotation: 180,
      zIndex: 0,
      locked: false,
      hidden: false,
      ports: [{ id: 'p', side: 'top' as const, offset: 0, data: {} }],
      data: {},
    };
    const anchor = edgeAnchor(node, 'p');
    // Top-left port rotated 180° about (50,20) lands at (100,40).
    expect(anchor.x).toBeCloseTo(100);
    expect(anchor.y).toBeCloseTo(40);
  });

  it('hides hidden nodes and their incident edges', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a');
    addNode(editor, 'b', 200, 0);
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    expect(scene.size).toBe(3);

    editor.execute(commands.nodeUpdate('a', { hidden: true }));
    expect(scene.items().map((i) => i.id)).toEqual(['node:b']);

    editor.execute(commands.nodeUpdate('a', { hidden: false }));
    expect(scene.size).toBe(3);
  });

  it('collapsed groups hide members and incident edges, and render a proxy', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a', 0, 0);
    addNode(editor, 'b', 200, 100);
    addNode(editor, 'c', 500, 0);
    editor.execute(commands.edgeAdd({ id: 'inner', source: 'a', target: 'b' }));
    editor.execute(commands.edgeAdd({ id: 'outgoing', source: 'b', target: 'c' }));
    editor.execute(
      commands.groupCreate({ id: 'g', members: ['a', 'b'], label: 'Cluster' }),
    );
    expect(scene.size).toBe(5); // 3 shapes + 2 paths; expanded group renders nothing

    editor.execute(commands.groupCollapse('g'));
    const ids = scene.items().map((i) => i.id);
    expect(ids).toEqual(['node:c', 'group:g', 'label:group:g']);
    // Proxy covers the union of members: a(0,0,100,40) ∪ b(200,100,100,40).
    expect(scene.get('group:g')).toMatchObject({
      kind: 'shape',
      element: 'group',
      rect: { x: 0, y: 0, width: 300, height: 140 },
    });

    editor.execute(commands.groupExpand('g'));
    expect(scene.size).toBe(5);
  });

  it('orders items by layer, then zIndex, labels above their shape', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'low', 0, 0, { zIndex: -1, data: { label: 'L' } });
    addNode(editor, 'high', 10, 10, { zIndex: 5 });
    editor.execute(commands.edgeAdd({ id: 'e', source: 'low', target: 'high', zIndex: 9 }));
    // Edges paint below nodes even at higher zIndex (layer groups, P3-T07).
    expect(scene.items().map((i) => i.id)).toEqual([
      'edge:e',
      'node:low',
      'label:node:low',
      'node:high',
    ]);
  });

  it('bounds() unions item bounds and is null when empty', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    expect(scene.bounds()).toBeNull();
    addNode(editor, 'a', 0, 0);
    addNode(editor, 'b', 400, 300);
    expect(scene.bounds()).toEqual({ x: 0, y: 0, width: 500, height: 340 });
  });

  it('destroy() stops updating', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a');
    scene.destroy();
    addNode(editor, 'b');
    expect(scene.items().map((i) => i.id)).toEqual(['node:a']);
  });
});

describe('SceneGraph dirty sets', () => {
  it('tracks added / updated / removed across takes', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a');
    expect(scene.takeDirty()).toEqual({ added: ['node:a'], updated: [], removed: [] });

    editor.execute(commands.nodeUpdate('a', { position: { x: 5, y: 5 } }));
    expect(scene.takeDirty()).toEqual({ added: [], updated: ['node:a'], removed: [] });

    editor.execute(commands.nodeRemove('a'));
    expect(scene.takeDirty()).toEqual({ added: [], updated: [], removed: ['node:a'] });

    // Add + remove between takes cancels out entirely.
    addNode(editor, 'ghost');
    editor.execute(commands.nodeRemove('ghost'));
    expect(scene.takeDirty()).toEqual({ added: [], updated: [], removed: [] });
  });

  it('a no-op change produces no dirty entries', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a', 1, 2);
    scene.takeDirty();
    editor.execute(commands.nodeUpdate('a', { position: { x: 1, y: 2 } }));
    expect(scene.takeDirty()).toEqual({ added: [], updated: [], removed: [] });
  });

  it('moving a node dirties its incident edges too', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    addNode(editor, 'a');
    addNode(editor, 'b', 200, 0);
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    scene.takeDirty();
    editor.execute(commands.nodeUpdate('a', { position: { x: -50, y: -50 } }));
    const dirty = scene.takeDirty();
    expect([...dirty.updated].sort()).toEqual(['edge:e', 'node:a']);
  });
});

// ---- the R1 acceptance property -------------------------------------------
// Any random command sequence: the incrementally maintained scene must deep-
// equal a from-scratch derivation, and replaying dirty sets must reproduce
// the item map exactly.

interface Shadow {
  map: Map<RenderItemId, RenderItem>;
}

const applyDirty = (shadow: Shadow, scene: SceneGraph): void => {
  const dirty = scene.takeDirty();
  for (const id of dirty.removed) {
    expect(shadow.map.has(id)).toBe(true);
    shadow.map.delete(id);
  }
  for (const id of dirty.added) {
    expect(shadow.map.has(id)).toBe(false);
    shadow.map.set(id, scene.get(id) as RenderItem);
  }
  for (const id of dirty.updated) {
    expect(shadow.map.has(id)).toBe(true);
    shadow.map.set(id, scene.get(id) as RenderItem);
  }
};

// Op descriptors use abstract indexes resolved against live model state, so
// every generated sequence is valid by construction.
const opArb = fc.oneof(
  fc.record({
    op: fc.constant('addNode' as const),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    w: fc.integer({ min: 1, max: 200 }),
    h: fc.integer({ min: 1, max: 200 }),
    rotation: fc.constantFrom(0, 45, 90, 180, 270),
    z: fc.integer({ min: -3, max: 3 }),
    hidden: fc.boolean(),
    ellipse: fc.boolean(),
    label: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
    withPort: fc.boolean(),
  }),
  fc.record({
    op: fc.constant('updateNode' as const),
    pick: fc.nat(),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    hidden: fc.option(fc.boolean(), { nil: undefined }),
    z: fc.option(fc.integer({ min: -3, max: 3 }), { nil: undefined }),
    label: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  }),
  fc.record({ op: fc.constant('removeNode' as const), pick: fc.nat() }),
  fc.record({
    op: fc.constant('addEdge' as const),
    pickA: fc.nat(),
    pickB: fc.nat(),
    routing: fc.constantFrom('straight' as const, 'orthogonal' as const, 'bezier' as const),
    usePort: fc.boolean(),
    label: fc.option(
      fc.record({ text: fc.string({ minLength: 1, maxLength: 8 }), position: fc.double({ min: 0, max: 1, noNaN: true }) }),
      { nil: undefined },
    ),
    z: fc.integer({ min: -3, max: 3 }),
  }),
  fc.record({
    op: fc.constant('updateEdge' as const),
    pick: fc.nat(),
    routing: fc.option(
      fc.constantFrom('straight' as const, 'orthogonal' as const, 'bezier' as const),
      { nil: undefined },
    ),
    hidden: fc.option(fc.boolean(), { nil: undefined }),
    rewire: fc.option(fc.nat(), { nil: undefined }),
  }),
  fc.record({ op: fc.constant('removeEdge' as const), pick: fc.nat() }),
  fc.record({
    op: fc.constant('createGroup' as const),
    picks: fc.array(fc.nat(), { minLength: 1, maxLength: 4 }),
    collapsed: fc.boolean(),
    label: fc.option(fc.string({ minLength: 1, maxLength: 8 }), { nil: undefined }),
  }),
  fc.record({ op: fc.constant('toggleGroup' as const), pick: fc.nat() }),
  fc.record({ op: fc.constant('dissolveGroup' as const), pick: fc.nat() }),
  fc.record({
    op: fc.constant('groupMembers' as const),
    pick: fc.nat(),
    add: fc.boolean(),
    member: fc.nat(),
  }),
);

type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;

let nextId = 0;
const applyOp = (editor: GraphEditor, op: Op): void => {
  const nodes = editor.graph.nodes();
  const edges = editor.graph.edges();
  const groups = editor.graph.groups();
  const pickFrom = <T>(list: readonly T[], index: number): T | undefined =>
    list.length === 0 ? undefined : list[index % list.length];

  switch (op.op) {
    case 'addNode': {
      editor.execute(
        commands.nodeAdd({
          id: `n${nextId++}`,
          position: { x: op.x, y: op.y },
          size: { width: op.w, height: op.h },
          rotation: op.rotation,
          zIndex: op.z,
          hidden: op.hidden,
          type: op.ellipse ? 'ellipse' : 'default',
          data: op.label === undefined ? {} : { label: op.label },
          ports: op.withPort ? [{ id: 'p0', side: 'right', offset: 0.5 }] : [],
        }),
      );
      return;
    }
    case 'updateNode': {
      const node = pickFrom(nodes, op.pick);
      if (!node) return;
      editor.execute(
        commands.nodeUpdate(node.id, {
          position: { x: op.x, y: op.y },
          ...(op.hidden === undefined ? {} : { hidden: op.hidden }),
          ...(op.z === undefined ? {} : { zIndex: op.z }),
          ...(op.label === undefined ? {} : { data: { label: op.label } }),
        }),
      );
      return;
    }
    case 'removeNode': {
      const node = pickFrom(nodes, op.pick);
      if (node) editor.execute(commands.nodeRemove(node.id));
      return;
    }
    case 'addEdge': {
      const source = pickFrom(nodes, op.pickA);
      const target = pickFrom(nodes, op.pickB);
      if (!source || !target) return;
      editor.execute(
        commands.edgeAdd({
          id: `e${nextId++}`,
          source: source.id,
          target: target.id,
          routing: op.routing,
          zIndex: op.z,
          labels: op.label === undefined ? [] : [op.label],
          ...(op.usePort && source.ports.length > 0 ? { sourcePort: 'p0' } : {}),
        }),
      );
      return;
    }
    case 'updateEdge': {
      const edge = pickFrom(edges, op.pick);
      if (!edge) return;
      const rewireTo = op.rewire === undefined ? undefined : pickFrom(nodes, op.rewire);
      editor.execute(
        commands.edgeUpdate(edge.id, {
          ...(op.routing === undefined ? {} : { routing: op.routing }),
          ...(op.hidden === undefined ? {} : { hidden: op.hidden }),
          ...(rewireTo === undefined ? {} : { target: rewireTo.id, targetPort: null }),
        }),
      );
      return;
    }
    case 'removeEdge': {
      const edge = pickFrom(edges, op.pick);
      if (edge) editor.execute(commands.edgeRemove(edge.id));
      return;
    }
    case 'createGroup': {
      if (nodes.length === 0) return;
      const members = [...new Set(op.picks.map((p) => (pickFrom(nodes, p) as { id: string }).id))];
      const id = `g${nextId++}`;
      editor.execute(
        commands.groupCreate({
          id,
          members,
          ...(op.label === undefined ? {} : { label: op.label }),
        }),
      );
      if (op.collapsed) editor.execute(commands.groupCollapse(id));
      return;
    }
    case 'toggleGroup': {
      const group = pickFrom(groups, op.pick);
      if (!group) return;
      editor.execute(
        group.collapsed ? commands.groupExpand(group.id) : commands.groupCollapse(group.id),
      );
      return;
    }
    case 'dissolveGroup': {
      const group = pickFrom(groups, op.pick);
      if (group) editor.execute(commands.groupDissolve(group.id));
      return;
    }
    case 'groupMembers': {
      const group = pickFrom(groups, op.pick);
      const node = pickFrom(nodes, op.member);
      if (!group || !node) return;
      if (op.add && !group.members.includes(node.id)) {
        editor.execute(commands.groupAdd(group.id, [node.id]));
      } else if (!op.add && group.members.includes(node.id)) {
        editor.execute(commands.groupRemove(group.id, [node.id]));
      }
      return;
    }
  }
};

describe('R1 property: incremental scene ≡ full rebuild', () => {
  it('holds for any random command sequence, after every command', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 40 }), (ops) => {
        const editor = createGraph();
        const scene = new SceneGraph(editor);
        const shadow: Shadow = { map: new Map() };
        applyDirty(shadow, scene);
        for (const op of ops) {
          applyOp(editor, op);
          // Oracle 1: a from-scratch derivation over the same model.
          const oracle = new SceneGraph(editor);
          expect(scene.items()).toEqual(oracle.items());
          oracle.destroy();
          // Oracle 2: replaying dirty sets reproduces the item map exactly.
          applyDirty(shadow, scene);
          expect(new Map([...shadow.map].sort())).toEqual(
            new Map(scene.items().map((item) => [item.id, item] as const)),
          );
        }
        scene.destroy();
      }),
      { numRuns: 60 },
    );
  });

  it('rebuild() on a live scene is a no-op (fallback parity)', () => {
    fc.assert(
      fc.property(fc.array(opArb, { minLength: 1, maxLength: 25 }), (ops) => {
        const editor = createGraph();
        const scene = new SceneGraph(editor);
        for (const op of ops) applyOp(editor, op);
        const before = scene.items();
        scene.takeDirty();
        scene.rebuild();
        expect(scene.items()).toEqual(before);
        expect(scene.takeDirty()).toEqual({ added: [], updated: [], removed: [] });
        scene.destroy();
      }),
      { numRuns: 30 },
    );
  });
});
