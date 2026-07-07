import { expect, it } from 'vitest';
import { commands } from './builtins.js';
import { createGraph, type GraphEditor } from './editor.js';
import { CommandValidationError } from './errors.js';
import type { GraphEventMap } from './events.js';

function editorWithNode(): GraphEditor {
  const editor = createGraph();
  editor.execute(commands.nodeAdd({ id: 'a', data: { label: 'old', keep: 1 } }));
  return editor;
}

it('node.update replaces top-level keys wholesale — data is not deep-merged', () => {
  const editor = editorWithNode();
  editor.execute(commands.nodeUpdate('a', { data: { label: 'new' } }));
  // `keep` is gone: replace-per-key semantics (Decision Log)
  expect(editor.graph.getNode('a')!.data).toEqual({ label: 'new' });
});

it('property.changed events carry path, old and new values (P2-T09 acceptance)', () => {
  const editor = editorWithNode();
  const events: Array<GraphEventMap['property.changed']> = [];
  editor.on('property.changed', (e) => events.push(e));
  editor.execute(
    commands.nodeUpdate('a', { position: { x: 5, y: 6 }, data: { label: 'new' } }),
  );
  expect(events).toEqual([
    {
      target: 'node',
      id: 'a',
      path: 'position',
      previous: { x: 0, y: 0 },
      value: { x: 5, y: 6 },
    },
    {
      target: 'node',
      id: 'a',
      path: 'data',
      previous: { label: 'old', keep: 1 },
      value: { label: 'new' },
    },
  ]);
});

it('null clears optional properties and the inverse restores their absence', () => {
  const editor = editorWithNode();
  let inverse: import('./types.js').Command | undefined;
  editor.on('graph.change', ({ operations }) => {
    inverse = operations[0]!.inverse;
  });
  editor.execute(commands.nodeUpdate('a', { style: 'primary' }));
  expect(editor.graph.getNode('a')!.style).toBe('primary');
  expect(inverse!.payload).toEqual({ id: 'a', changes: { style: null } });
  editor.execute(commands.nodeUpdate('a', { style: null }));
  expect('style' in editor.graph.getNode('a')!).toBe(false);
});

it('rejects unknown or immutable keys on updates', () => {
  const editor = editorWithNode();
  expect(() =>
    editor.execute({ type: 'node.update', payload: { id: 'a', changes: { id: 'b' } } }),
  ).toThrow(CommandValidationError);
  expect(() =>
    editor.execute({ type: 'node.update', payload: { id: 'a', changes: { bogus: 1 } } }),
  ).toThrow(/unknown or immutable property/);
  expect(() =>
    editor.execute({ type: 'graph.update', payload: { changes: { id: 'nope' } } }),
  ).toThrow(/unknown or immutable property/);
});

it('edge.update rewires endpoints, validates them, and emits property.changed', () => {
  const editor = editorWithNode();
  editor.execute(commands.nodeAdd({ id: 'b' }));
  editor.execute(commands.nodeAdd({ id: 'c' }));
  editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
  const events: Array<GraphEventMap['property.changed']> = [];
  editor.on('property.changed', (e) => events.push(e));
  editor.execute(commands.edgeUpdate('e', { target: 'c' }));
  expect(editor.graph.edgesOf('b').in).toEqual([]);
  expect(editor.graph.edgesOf('c').in).toEqual(['e']);
  expect(events).toEqual([
    { target: 'edge', id: 'e', path: 'target', previous: 'b', value: 'c' },
  ]);
  expect(() => editor.execute(commands.edgeUpdate('e', { target: 'ghost' }))).toThrow(
    CommandValidationError,
  );
});

it('edge.add checks that referenced ports exist', () => {
  const editor = createGraph();
  editor.execute(commands.nodeAdd({ id: 'a', ports: [{ id: 'p1' }] }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  editor.execute(commands.edgeAdd({ id: 'ok', source: 'a', target: 'b', sourcePort: 'p1' }));
  expect(editor.graph.getEdge('ok')!.sourcePort).toBe('p1');
  expect(() =>
    editor.execute(commands.edgeAdd({ source: 'a', target: 'b', sourcePort: 'ghost' })),
  ).toThrow(/no port ghost/);
  expect(() =>
    editor.execute(commands.edgeAdd({ source: 'b', target: 'a', targetPort: 'ghost' })),
  ).toThrow(/no port ghost/);
});

it('a host-registered connection validator rejects an edge with a typed error and no state change', () => {
  const editor = editorWithNode();
  editor.execute(commands.nodeAdd({ id: 'b', data: { kind: 'sink' } }));
  editor.registries.validators.set('no-into-sink', (model, edge) =>
    model.getNode(edge.source)?.data['kind'] === 'sink' ? 'sinks have no outputs' : true,
  );
  const before = editor.snapshot();
  expect(() => editor.execute(commands.edgeAdd({ source: 'b', target: 'a' }))).toThrow(
    'edge.add: sinks have no outputs',
  );
  expect(editor.snapshot()).toEqual(before);
  editor.execute(commands.edgeAdd({ id: 'fine', source: 'a', target: 'b' }));
  expect(editor.graph.edgeCount).toBe(1);
});

it('graph.update patches metadata with an exact inverse', () => {
  const editor = createGraph({
    meta: { id: 'doc', name: 'v1', createdAt: 'c', modifiedAt: 'c' },
  });
  const updates: Array<GraphEventMap['graph.updated']> = [];
  editor.on('graph.updated', (e) => updates.push(e));
  let inverse: import('./types.js').Command | undefined;
  editor.on('graph.change', ({ operations }) => {
    inverse = operations[0]!.inverse;
  });
  editor.execute(commands.graphUpdate({ name: 'v2', modifiedAt: 'm' }));
  expect(editor.graph.meta).toEqual({ id: 'doc', name: 'v2', createdAt: 'c', modifiedAt: 'm' });
  expect(updates).toHaveLength(1);
  expect(inverse).toEqual({
    type: 'graph.update',
    payload: { changes: { name: 'v1', modifiedAt: 'c' } },
  });
  editor.execute(inverse!);
  expect(editor.graph.meta.name).toBe('v1');
});

it('z.reorder targets nodes and edges and rejects unknown ids', () => {
  const editor = editorWithNode();
  editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'a' }));
  editor.execute(commands.zReorder('a', 7));
  editor.execute(commands.zReorder('e', -2));
  expect(editor.graph.getNode('a')!.zIndex).toBe(7);
  expect(editor.graph.getEdge('e')!.zIndex).toBe(-2);
  expect(() => editor.execute(commands.zReorder('ghost', 1))).toThrow(/unknown node or edge/);
});

it('group collapse/expand validate current state so inverses stay exact', () => {
  const editor = editorWithNode();
  editor.execute(commands.groupCreate({ id: 'g', members: ['a'] }));
  expect(() => editor.execute(commands.groupExpand('g'))).toThrow(/not collapsed/);
  editor.execute(commands.groupCollapse('g'));
  expect(editor.graph.getGroup('g')!.collapsed).toBe(true);
  expect(() => editor.execute(commands.groupCollapse('g'))).toThrow(/already collapsed/);
  editor.execute(commands.groupExpand('g'));
  expect(editor.graph.getGroup('g')!.collapsed).toBe(false);
});

it('group membership commands validate members and keep canonical order', () => {
  const editor = editorWithNode();
  editor.execute(commands.nodeAdd({ id: 'z' }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  editor.execute(commands.groupCreate({ id: 'g', members: ['z', 'a'] }));
  expect(editor.graph.getGroup('g')!.members).toEqual(['a', 'z']); // sorted
  editor.execute(commands.groupAdd('g', ['b']));
  expect(editor.graph.getGroup('g')!.members).toEqual(['a', 'b', 'z']);
  expect(() => editor.execute(commands.groupAdd('g', ['b']))).toThrow(/already a member/);
  expect(() => editor.execute(commands.groupAdd('g', ['ghost']))).toThrow(/unknown member/);
  expect(() => editor.execute(commands.groupAdd('g', ['c', 'c']))).toThrow(/duplicate members/);
  expect(() => editor.execute(commands.groupRemove('g', ['ghost']))).toThrow(/not a member/);
  expect(() =>
    editor.execute(commands.groupCreate({ id: 'g2', members: ['a', 'a'] })),
  ).toThrow(/duplicate members/);
  editor.execute(commands.groupRemove('g', ['a', 'z']));
  expect(editor.graph.getGroup('g')!.members).toEqual(['b']);
});
