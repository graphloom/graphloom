import { expect, it } from 'vitest';
import { commands, createEdge, createGroup, createNode } from './builtins.js';
import { createGraph, type GraphEditor } from './editor.js';
import { GraphModel, type GraphView } from './model.js';
import type { GraphMeta } from './types.js';

const meta: GraphMeta = {
  id: 'doc',
  name: 'test',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

function editorWith(nodeIds: string[]): GraphEditor {
  const editor = createGraph({ meta });
  editor.transact(() => {
    for (const id of nodeIds) editor.execute(commands.nodeAdd({ id }));
  });
  return editor;
}

/** Recomputes every index by brute force and compares (P2-T02 acceptance). */
function verifyIndexes(graph: GraphView): void {
  for (const node of graph.nodes()) {
    const expectedIn = graph
      .edges()
      .filter((e) => e.target === node.id)
      .map((e) => e.id)
      .sort();
    const expectedOut = graph
      .edges()
      .filter((e) => e.source === node.id)
      .map((e) => e.id)
      .sort();
    const actual = graph.edgesOf(node.id);
    expect([...actual.in].sort()).toEqual(expectedIn);
    expect([...actual.out].sort()).toEqual(expectedOut);
    const expectedGroups = graph
      .groups()
      .filter((g) => g.members.includes(node.id))
      .map((g) => g.id)
      .sort();
    expect([...graph.groupsOf(node.id)].sort()).toEqual(expectedGroups);
  }
}

it('returns frozen views in dev: mutating a read throws', () => {
  const editor = editorWith(['a']);
  const node = editor.graph.getNode('a')!;
  expect(() => {
    (node as { zIndex: number }).zIndex = 99;
  }).toThrow(TypeError);
  expect(() => {
    (node.position as { x: number }).x = 5; // nested objects are frozen too
  }).toThrow(TypeError);
  expect(() => {
    (editor.graph.meta as { name: string }).name = 'x';
  }).toThrow(TypeError);
});

it('keeps every index in sync through a mixed mutation sequence', () => {
  const editor = editorWith(['a', 'b', 'c', 'd']);
  const steps = [
    commands.edgeAdd({ id: 'e1', source: 'a', target: 'b' }),
    commands.edgeAdd({ id: 'e2', source: 'b', target: 'c' }),
    commands.edgeAdd({ id: 'e3', source: 'a', target: 'a' }), // self-loop
    commands.edgeAdd({ id: 'e4', source: 'a', target: 'b' }), // duplicate pair
    commands.groupCreate({ id: 'g1', members: ['a', 'b'] }),
    commands.groupCreate({ id: 'g2', members: ['b', 'c'] }),
    commands.edgeUpdate('e1', { source: 'd' }), // re-index endpoints
    commands.groupAdd('g1', ['d']),
    commands.groupRemove('g2', ['b']),
    commands.edgeRemove('e2'),
    commands.nodeRemove('b'), // cascades e4 + g1 membership
    commands.groupDissolve('g2'),
  ];
  for (const step of steps) {
    editor.execute(step);
    verifyIndexes(editor.graph);
  }
});

it('cascades node deletion atomically: edges and group membership go with it', () => {
  const editor = editorWith(['a', 'b']);
  editor.execute(commands.edgeAdd({ id: 'in', source: 'b', target: 'a' }));
  editor.execute(commands.edgeAdd({ id: 'out', source: 'a', target: 'b' }));
  editor.execute(commands.edgeAdd({ id: 'loop', source: 'a', target: 'a' }));
  editor.execute(commands.groupCreate({ id: 'g', members: ['a', 'b'] }));
  editor.execute(commands.nodeRemove('a'));
  expect(editor.graph.getNode('a')).toBeUndefined();
  expect(editor.graph.edges()).toEqual([]);
  expect(editor.graph.getGroup('g')!.members).toEqual(['b']);
  verifyIndexes(editor.graph);
});

it('supports self-loops and duplicate edges between the same pair', () => {
  const editor = editorWith(['a', 'b']);
  editor.execute(commands.edgeAdd({ id: 'e1', source: 'a', target: 'b' }));
  editor.execute(commands.edgeAdd({ id: 'e2', source: 'a', target: 'b' }));
  editor.execute(commands.edgeAdd({ id: 'loop', source: 'a', target: 'a' }));
  expect(editor.graph.edgeCount).toBe(3);
  expect([...editor.graph.edgesOf('a').out].sort()).toEqual(['e1', 'e2', 'loop']);
  expect(editor.graph.edgesOf('a').in).toEqual(['loop']);
  editor.execute(commands.edgeRemove('loop'));
  expect(editor.graph.edgesOf('a').in).toEqual([]);
  expect([...editor.graph.edgesOf('a').out].sort()).toEqual(['e1', 'e2']);
});

it('nodesByZ sorts by zIndex, ties by id', () => {
  const editor = editorWith(['b', 'a', 'c']);
  editor.execute(commands.nodeUpdate('c', { zIndex: -1 }));
  expect(editor.graph.nodesByZ().map((n) => n.id)).toEqual(['c', 'a', 'b']);
});

it('exposes O(1) counts and lookups', () => {
  const editor = editorWith(['a', 'b']);
  editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
  expect(editor.graph.nodeCount).toBe(2);
  expect(editor.graph.edgeCount).toBe(1);
  expect(editor.graph.getEdge('e')!.source).toBe('a');
  expect(editor.graph.getGroup('nope')).toBeUndefined();
  expect(editor.graph.edgesOf('unknown')).toEqual({ in: [], out: [] });
  expect(editor.graph.groupsOf('unknown')).toEqual([]);
});

it('mutators guard their invariants (defense against buggy commands)', () => {
  const model = new GraphModel(meta);
  const a = createNode({ id: 'a' });
  model.addNode(a);
  model.addNode(createNode({ id: 'b' }));
  expect(() => model.addNode(a)).toThrow(/duplicate node/);
  expect(() => model.replaceNode(createNode({ id: 'ghost' }))).toThrow(/unknown node/);
  expect(() => model.removeNode('ghost')).toThrow(/unknown node/);
  expect(() => model.removeEdge('ghost')).toThrow(/unknown edge/);
  expect(() => model.removeGroup('ghost')).toThrow(/unknown group/);
  const edge = createEdge({ id: 'e', source: 'a', target: 'b' });
  model.addEdge(edge);
  expect(() => model.addEdge(edge)).toThrow(/duplicate edge/);
  expect(() => model.addEdge(createEdge({ id: 'e2', source: 'ghost', target: 'b' }))).toThrow(
    /unknown source/,
  );
  expect(() => model.addEdge(createEdge({ id: 'e2', source: 'a', target: 'ghost' }))).toThrow(
    /unknown target/,
  );
  expect(() => model.replaceEdge(createEdge({ id: 'ghost', source: 'a', target: 'b' }))).toThrow(
    /unknown edge/,
  );
  expect(() =>
    model.replaceEdge(createEdge({ id: 'e', source: 'ghost', target: 'b' })),
  ).toThrow(/unknown source/);
  expect(() =>
    model.replaceEdge(createEdge({ id: 'e', source: 'a', target: 'ghost' })),
  ).toThrow(/unknown target/);
  // removeNode refuses while edges/memberships remain — the cascade can't be forgotten
  expect(() => model.removeNode('a')).toThrow(/still has edges/);
  model.removeEdge('e');
  const group = createGroup({ id: 'g', members: ['a'] });
  model.addGroup(group);
  expect(() => model.addGroup(group)).toThrow(/duplicate group/);
  expect(() => model.addGroup(createGroup({ id: 'g2', members: ['ghost'] }))).toThrow(
    /unknown member/,
  );
  expect(() => model.replaceGroup(createGroup({ id: 'ghost' }))).toThrow(/unknown group/);
  expect(() =>
    model.replaceGroup(createGroup({ id: 'g', members: ['ghost'] })),
  ).toThrow(/unknown member/);
  expect(() => model.removeNode('a')).toThrow(/still a group member/);
  model.removeGroup('g');
  model.removeNode('a');
  expect(model.nodeCount).toBe(1);
});
