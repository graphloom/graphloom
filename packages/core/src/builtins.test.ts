import { expect, it } from 'vitest';
import { commands, createEdge, createGroup, createNode } from './builtins.js';
import { createGraph } from './editor.js';
import type { GraphView } from './model.js';
import type { AppliedOperation, Command } from './types.js';

// Deterministic RNG so fuzz failures reproduce (seed printed on failure).
function mulberry32(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) | 0;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function makeGenerator(seed: number): (graph: GraphView) => Command | undefined {
  const rng = mulberry32(seed);
  const pick = <T>(items: readonly T[]): T => items[Math.floor(rng() * items.length)]!;
  const int = (max: number): number => Math.floor(rng() * max);
  let counter = 0;
  return (graph) => {
    const nodes = graph.nodes();
    const edges = graph.edges();
    const groups = graph.groups();
    const choices: Array<() => Command | undefined> = [
      () =>
        commands.nodeAdd({
          id: `n${counter++}`,
          position: { x: int(500), y: int(500) },
          zIndex: int(5),
          ...(rng() < 0.3 && { style: `s${int(3)}` }),
          ...(rng() < 0.3 && { ports: [{ id: 'p1' }, { id: 'p2', side: 'left' as const }] }),
          data: { v: int(100) },
        }),
      () => (nodes.length > 0 ? commands.nodeRemove(pick(nodes).id) : undefined),
      () =>
        nodes.length > 0
          ? commands.nodeUpdate(pick(nodes).id, {
              position: { x: int(500), y: int(500) },
              rotation: int(360),
              ...(rng() < 0.5 && { style: rng() < 0.5 ? `s${int(3)}` : null }),
              ...(rng() < 0.5 && { data: { v: int(100), w: int(9) } }),
            })
          : undefined,
      () =>
        nodes.length > 0
          ? commands.edgeAdd({
              id: `e${counter++}`,
              source: pick(nodes).id,
              target: pick(nodes).id,
              zIndex: int(5),
            })
          : undefined,
      () => (edges.length > 0 ? commands.edgeRemove(pick(edges).id) : undefined),
      () =>
        edges.length > 0
          ? commands.edgeUpdate(pick(edges).id, {
              routing: pick(['straight', 'orthogonal', 'bezier'] as const),
              labels: [{ text: `l${int(9)}`, position: 0.5 }],
              ...(rng() < 0.3 && nodes.length > 0 && { target: pick(nodes).id }),
            })
          : undefined,
      () => {
        if (nodes.length === 0) return undefined;
        const members = [...new Set([pick(nodes).id, pick(nodes).id, pick(nodes).id])];
        return commands.groupCreate({
          id: `g${counter++}`,
          members,
          ...(rng() < 0.5 && { label: `grp${int(9)}` }),
        });
      },
      () => (groups.length > 0 ? commands.groupDissolve(pick(groups).id) : undefined),
      () => {
        const candidates = groups
          .map((group) => ({
            group,
            outside: nodes.filter((n) => !group.members.includes(n.id)),
          }))
          .filter((c) => c.outside.length > 0);
        if (candidates.length === 0) return undefined;
        const c = pick(candidates);
        return commands.groupAdd(c.group.id, [pick(c.outside).id]);
      },
      () => {
        const candidates = groups.filter((g) => g.members.length > 0);
        if (candidates.length === 0) return undefined;
        const group = pick(candidates);
        return commands.groupRemove(group.id, [pick(group.members)]);
      },
      () => {
        const open = groups.filter((g) => !g.collapsed);
        return open.length > 0 ? commands.groupCollapse(pick(open).id) : undefined;
      },
      () => {
        const closed = groups.filter((g) => g.collapsed);
        return closed.length > 0 ? commands.groupExpand(pick(closed).id) : undefined;
      },
      () => commands.graphUpdate({ name: `doc${int(10)}`, modifiedAt: `t${int(10)}` }),
      () => {
        const all = [...nodes, ...edges];
        return all.length > 0 ? commands.zReorder(pick(all).id, int(10)) : undefined;
      },
    ];
    for (let attempt = 0; attempt < 10; attempt++) {
      const command = pick(choices)();
      if (command) return command;
    }
    return undefined;
  };
}

const meta = { id: 'doc', name: 'fuzz', createdAt: 't0', modifiedAt: 't0' };

for (const seed of [1, 20260707, 0xc0ffee]) {
  it(`apply → invert → apply⁻¹ ≡ identity for random commands (R5 fuzz, seed ${seed})`, () => {
    const next = makeGenerator(seed);
    const editor = createGraph({
      meta,
      limits: { maxNodes: Infinity, maxEdges: Infinity },
    });
    let lastOps: readonly AppliedOperation[] = [];
    editor.on('graph.change', (e) => {
      lastOps = e.operations;
    });
    let produced = 0;
    for (let i = 0; i < 300; i++) {
      const command = next(editor.graph);
      if (!command) continue;
      produced++;
      // every command is JSON-serializable (ADR-0001)
      expect(JSON.parse(JSON.stringify(command))).toEqual(command);
      const before = editor.snapshot();
      editor.execute(command);
      const after = editor.snapshot();
      const [op] = lastOps;
      expect(lastOps).toHaveLength(1);
      // the inverse is JSON-serializable too, and restores the exact state
      expect(JSON.parse(JSON.stringify(op!.inverse))).toEqual(op!.inverse);
      editor.execute(op!.inverse, { source: 'history' });
      expect(editor.snapshot()).toEqual(before);
      // replaying the command lands back on the exact post state (redo path)
      editor.execute(op!.command, { source: 'history' });
      expect(editor.snapshot()).toEqual(after);
    }
    expect(produced).toBeGreaterThan(250);
  });
}

it('node.remove inverse restores cascaded edges and group membership (P2-T05 acceptance)', () => {
  const editor = createGraph({ meta });
  editor.transact(() => {
    for (const id of ['a', 'b', 'c']) editor.execute(commands.nodeAdd({ id }));
    editor.execute(commands.edgeAdd({ id: 'out', source: 'a', target: 'b' }));
    editor.execute(commands.edgeAdd({ id: 'in', source: 'c', target: 'a' }));
    editor.execute(commands.edgeAdd({ id: 'loop', source: 'a', target: 'a' }));
    editor.execute(commands.edgeAdd({ id: 'dup', source: 'a', target: 'b' }));
    editor.execute(commands.groupCreate({ id: 'g1', members: ['a', 'b'] }));
    editor.execute(commands.groupCreate({ id: 'g2', members: ['a', 'c'] }));
  });
  const before = editor.snapshot();
  let inverse: Command | undefined;
  editor.on('graph.change', ({ operations }) => {
    inverse = operations[0]!.inverse;
  });
  editor.execute(commands.nodeRemove('a'));
  expect(editor.graph.edges()).toEqual([]);
  expect(editor.graph.getGroup('g1')!.members).toEqual(['b']);
  editor.execute(inverse!, { source: 'history' });
  expect(editor.snapshot()).toEqual(before);
});

it('factories fill documented defaults', () => {
  const node = createNode();
  expect(node).toMatchObject({
    type: 'default',
    position: { x: 0, y: 0 },
    size: { width: 100, height: 40 },
    rotation: 0,
    zIndex: 0,
    locked: false,
    hidden: false,
    ports: [],
    data: {},
  });
  expect(node.id).toMatch(/^[0-9a-f-]{36}$/);
  expect('style' in node).toBe(false);
  const edge = createEdge({ source: 'a', target: 'b' });
  expect(edge).toMatchObject({
    type: 'default',
    routing: 'straight',
    labels: [],
    zIndex: 0,
    hidden: false,
    data: {},
  });
  const group = createGroup({ members: ['z', 'a'] });
  expect(group.members).toEqual(['a', 'z']);
  expect(group.collapsed).toBe(false);
  const port = createNode({ ports: [{ id: 'p' }] }).ports[0]!;
  expect(port).toEqual({ id: 'p', side: 'right', offset: 0.5, data: {} });
});
