import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { createHistory } from '@graphloom/history';
import { InteractionEngine } from '@graphloom/interaction';
import { SceneGraph, ViewportController } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import { EMPTY_GRAPH_STATE, createGraphStore } from './store.js';

const addNode = (editor: GraphEditor, id: string): void => {
  editor.execute(
    commands.nodeAdd({ id, position: { x: 0, y: 0 }, size: { width: 80, height: 40 } }),
  );
};

describe('createGraphStore (P6-T02)', () => {
  let editor: GraphEditor;

  beforeEach(() => {
    editor = createGraph();
    addNode(editor, 'a');
    addNode(editor, 'b');
    editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  });

  it('reflects the editor state at creation', () => {
    const store = createGraphStore({ editor });
    const state = store.getState();
    expect(state.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(state.edges.map((e) => e.id)).toEqual(['ab']);
    expect(state.groups).toEqual([]);
    expect(state.selection).toEqual([]);
    expect(state.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(state.canUndo).toBe(false);
  });

  it('keeps snapshot identity stable between changes (uSES contract)', () => {
    const store = createGraphStore({ editor });
    expect(store.getState()).toBe(store.getState());
    addNode(editor, 'c');
    expect(store.getState()).toBe(store.getState());
  });

  it('is slice-granular: unrelated commits keep a slice identity', () => {
    const store = createGraphStore({ editor });
    const before = store.getState();
    editor.execute(commands.nodeUpdate('a', { position: { x: 50, y: 50 } }));
    const after = store.getState();
    expect(after).not.toBe(before);
    expect(after.nodes).not.toBe(before.nodes); // nodes refreshed
    expect(after.edges).toBe(before.edges); // edges untouched (same reference)
    expect(after.groups).toBe(before.groups);
  });

  it('refreshes edges and groups when a node removal cascades — and on undo', () => {
    const history = createHistory(editor);
    const store = createGraphStore({ editor, history });
    const edgesBefore = store.getState().edges;
    editor.execute(commands.nodeRemove('a')); // cascades edge ab
    expect(store.getState().edges).not.toBe(edgesBefore);
    expect(store.getState().edges).toEqual([]);
    history.undo(); // replays node.restore — must refresh edges too
    expect(store.getState().nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(store.getState().edges.map((e) => e.id)).toEqual(['ab']);
  });

  it('batches per transaction: one notification per commit', () => {
    const store = createGraphStore({ editor });
    let notifications = 0;
    store.subscribe(() => notifications++);
    editor.transact(() => {
      addNode(editor, 'c');
      addNode(editor, 'd');
      addNode(editor, 'e');
    });
    expect(notifications).toBe(1); // three adds, one commit, one notification
    expect(store.getState().nodes).toHaveLength(5);
  });

  it('bridges selection, viewport and history when provided', () => {
    const viewport = new ViewportController({ size: { width: 800, height: 600 } });
    const history = createHistory(editor);
    const engine = new InteractionEngine({
      editor,
      scene: new SceneGraph(editor),
      viewport,
      history,
    });
    const store = createGraphStore({
      editor,
      selection: engine.selection,
      viewport,
      history,
    });

    engine.selection.set(['a']);
    expect(store.getState().selection).toEqual(['a']);

    viewport.panBy(10, 20);
    expect(store.getState().viewport).toEqual({ x: 10, y: 20, zoom: 1 });

    addNode(editor, 'c');
    expect(store.getState().canUndo).toBe(true);
    history.undo();
    expect(store.getState().canUndo).toBe(false);
    expect(store.getState().canRedo).toBe(true);
  });

  it('routes group commands to the groups slice and metadata to none', () => {
    const store = createGraphStore({ editor });
    const before = store.getState();
    editor.execute(commands.groupCreate({ id: 'g', members: ['a', 'b'] }));
    expect(store.getState().groups.map((g) => g.id)).toEqual(['g']);
    expect(store.getState().nodes).toBe(before.nodes);
    const afterGroup = store.getState();
    editor.execute(commands.graphUpdate({ name: 'renamed' }));
    expect(store.getState()).toBe(afterGroup); // metadata publishes no state
  });

  it('refreshes every slice on unknown (plugin) command types', () => {
    const store = createGraphStore({ editor });
    const before = store.getState();
    editor.execute(commands.zReorder('a', 5)); // 'z.reorder' — no known prefix
    expect(store.getState().nodes).not.toBe(before.nodes);
    expect(store.getState().edges).not.toBe(before.edges);
    expect(store.getState().groups).not.toBe(before.groups);
  });

  it('unsubscribe stops notifications; destroy freezes the store (leak test)', () => {
    const history = createHistory(editor);
    const store = createGraphStore({ editor, history });
    let notifications = 0;
    const unsubscribe = store.subscribe(() => notifications++);
    addNode(editor, 'c');
    expect(notifications).toBe(2); // graph.change + history.changed
    unsubscribe();
    addNode(editor, 'd');
    expect(notifications).toBe(2);

    store.destroy();
    const frozen = store.getState();
    addNode(editor, 'e');
    expect(store.getState()).toBe(frozen); // frozen at the last value
    store.destroy(); // idempotent
  });

  it('EMPTY_GRAPH_STATE is inert and frozen', () => {
    expect(EMPTY_GRAPH_STATE.nodes).toEqual([]);
    expect(EMPTY_GRAPH_STATE.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(Object.isFrozen(EMPTY_GRAPH_STATE)).toBe(true);
  });
});
