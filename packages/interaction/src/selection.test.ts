import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { SceneGraph, SpatialIndex } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import { Selection } from './selection.js';

let editor: GraphEditor;
let spatial: SpatialIndex;
let selection: Selection;

beforeEach(() => {
  editor = createGraph();
  editor.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 50, height: 30 } }));
  editor.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 0 }, size: { width: 50, height: 30 } }));
  editor.execute(
    commands.nodeAdd({
      id: 'locked',
      position: { x: 0, y: 200 },
      size: { width: 50, height: 30 },
      locked: true,
    }),
  );
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  spatial = new SpatialIndex(new SceneGraph(editor));
  selection = new Selection(editor);
});

describe('Selection', () => {
  it('set/add/toggle/clear fire selection.changed once per change', () => {
    const events: (readonly string[])[] = [];
    selection.on('selection.changed', ({ selected }) => events.push(selected));
    selection.set(['a']);
    selection.set(['a']); // no-op, no event
    selection.add(['b']);
    selection.add(['b']); // no-op
    selection.toggle('b');
    selection.clear();
    selection.clear(); // no-op
    expect(events).toEqual([['a'], ['a', 'b'], ['a'], []]);
  });

  it('selectAll picks visible nodes and edges, including locked', () => {
    editor.execute(commands.nodeAdd({ id: 'ghost', hidden: true }));
    selection.selectAll();
    expect([...selection.ids()].sort()).toEqual(['a', 'ab', 'b', 'locked']);
  });

  it('marquee selects exactly intersecting items, skipping locked', () => {
    selection.marquee({ x: -10, y: -10, width: 400, height: 300 }, spatial);
    expect([...selection.ids()].sort()).toEqual(['a', 'ab', 'b']);
    selection.marquee({ x: -10, y: -10, width: 30, height: 20 }, spatial);
    expect(selection.ids()).toEqual(['a']);
    selection.marquee({ x: 500, y: 500, width: 10, height: 10 }, spatial);
    expect(selection.size).toBe(0);
  });

  it('marquee add/toggle modes compose with the existing selection', () => {
    selection.set(['b']);
    selection.marquee({ x: -10, y: -10, width: 30, height: 20 }, spatial, 'add');
    expect([...selection.ids()].sort()).toEqual(['a', 'b']);
    selection.marquee({ x: -10, y: -10, width: 30, height: 20 }, spatial, 'toggle');
    expect(selection.ids()).toEqual(['b']);
  });

  it('deleted elements are pruned; unrelated updates leave selection intact', () => {
    selection.set(['a', 'b', 'ab']);
    editor.execute(commands.nodeUpdate('b', { position: { x: 999, y: 999 } }));
    expect(selection.size).toBe(3); // survives unrelated/related updates
    editor.execute(commands.nodeRemove('a')); // cascades edge ab
    expect([...selection.ids()].sort()).toEqual(['b']);
  });

  it('nodeIds filters out edge ids', () => {
    selection.set(['a', 'ab']);
    expect(selection.nodeIds()).toEqual(['a']);
  });

  it('dispose stops pruning', () => {
    selection.set(['b']);
    selection.dispose();
    editor.execute(commands.nodeRemove('b'));
    expect(selection.has('b')).toBe(true);
  });
});
