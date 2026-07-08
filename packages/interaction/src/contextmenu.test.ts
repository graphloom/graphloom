import { commands, createGraph, type GraphEditor, type GraphPlugin } from '@graphloom/core';
import { SceneGraph, SpatialIndex } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import { buildContextMenuRequest } from './contextmenu.js';
import { Selection } from './selection.js';

let editor: GraphEditor;
let spatial: SpatialIndex;
let selection: Selection;

const request = (x: number, y: number) =>
  buildContextMenuRequest(editor, selection, spatial, { x, y }, { x, y });

beforeEach(() => {
  editor = createGraph();
  editor.execute(
    commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 50, height: 30 } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'b', position: { x: 200, y: 0 }, size: { width: 50, height: 30 } }),
  );
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  spatial = new SpatialIndex(new SceneGraph(editor));
  selection = new Selection(editor);
});

describe('buildContextMenuRequest', () => {
  it('targets node, edge, canvas, and multi-selection correctly', () => {
    expect(request(25, 15).target).toEqual({ kind: 'node', id: 'a' });
    expect(request(125, 15).target).toEqual({ kind: 'edge', id: 'ab' }); // midway on the edge
    expect(request(500, 500).target).toEqual({ kind: 'canvas' });
    selection.set(['a', 'b']);
    expect(request(25, 15).target).toEqual({ kind: 'selection', selected: ['a', 'b'] });
    // Hit outside the selection is still an element target.
    expect(request(125, 15).target).toEqual({ kind: 'edge', id: 'ab' });
  });

  it('single-selected element is an element target, not a selection target', () => {
    selection.set(['a']);
    expect(request(25, 15).target).toEqual({ kind: 'node', id: 'a' });
  });

  it('plugin menu contributions appear and disappear with install/uninstall', () => {
    expect(request(500, 500).items).toEqual([]);
    const plugin: GraphPlugin = {
      id: 'test-menu',
      version: '1.0.0',
      install: (ctx) => {
        ctx.contributions.register('hello', { kind: 'menu', item: { label: 'Hello' } });
        ctx.contributions.register('tool', { kind: 'toolbar', item: { label: 'Nope' } });
      },
    };
    editor.use(plugin);
    const items = request(500, 500).items;
    expect(items).toHaveLength(1); // toolbar contributions are not menu items
    expect(items[0]?.item).toEqual({ label: 'Hello' });
    editor.unuse('test-menu');
    expect(request(500, 500).items).toEqual([]);
  });
});
