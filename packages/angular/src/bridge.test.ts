import { Injector, effect, provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { createHistory } from '@graphloom/history';
import { InteractionEngine } from '@graphloom/interaction';
import { SceneGraph, ViewportController } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import { createGraphSignals } from './bridge.js';

const addNode = (editor: GraphEditor, id: string): void => {
  editor.execute(
    commands.nodeAdd({ id, position: { x: 0, y: 0 }, size: { width: 80, height: 40 } }),
  );
};

describe('createGraphSignals (P5-T02)', () => {
  let editor: GraphEditor;

  beforeEach(() => {
    editor = createGraph();
    addNode(editor, 'a');
    addNode(editor, 'b');
    editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  });

  it('reflects the editor state at creation', () => {
    const signals = createGraphSignals({ editor });
    expect(signals.nodes().map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(signals.edges().map((e) => e.id)).toEqual(['ab']);
    expect(signals.groups()).toEqual([]);
    expect(signals.selection()).toEqual([]);
    expect(signals.viewport()).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(signals.canUndo()).toBe(false);
  });

  it('is slice-granular: unrelated commits do not touch a slice', () => {
    const signals = createGraphSignals({ editor });
    const nodesBefore = signals.nodes();
    const edgesBefore = signals.edges();
    editor.execute(commands.nodeUpdate('a', { position: { x: 50, y: 50 } }));
    expect(signals.nodes()).not.toBe(nodesBefore); // nodes refreshed
    expect(signals.edges()).toBe(edgesBefore); // edges untouched (same reference)
  });

  it('refreshes edges and groups when a node removal cascades', () => {
    const signals = createGraphSignals({ editor });
    const edgesBefore = signals.edges();
    editor.execute(commands.nodeRemove('a')); // cascades edge ab
    expect(signals.edges()).not.toBe(edgesBefore);
    expect(signals.edges()).toEqual([]);
  });

  it('batches per transaction: one effect run per commit', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const injector = TestBed.inject(Injector);
    const signals = createGraphSignals({ editor });
    let runs = 0;
    effect(
      () => {
        signals.nodes();
        runs++;
      },
      { injector },
    );
    TestBed.tick(); // initial run
    expect(runs).toBe(1);
    editor.transact(() => {
      addNode(editor, 'c');
      addNode(editor, 'd');
      addNode(editor, 'e');
    });
    TestBed.tick();
    expect(runs).toBe(2); // three adds, one commit, one recompute
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
    const signals = createGraphSignals({
      editor,
      selection: engine.selection,
      viewport,
      history,
    });

    engine.selection.set(['a']);
    expect(signals.selection()).toEqual(['a']);

    viewport.panBy(10, 20);
    expect(signals.viewport()).toEqual({ x: 10, y: 20, zoom: 1 });

    addNode(editor, 'c');
    expect(signals.canUndo()).toBe(true);
    history.undo();
    expect(signals.canUndo()).toBe(false);
    expect(signals.canRedo()).toBe(true);
  });

  it('routes group commands to the groups slice and metadata to none', () => {
    const signals = createGraphSignals({ editor });
    const nodesBefore = signals.nodes();
    editor.execute(commands.groupCreate({ id: 'g', members: ['a', 'b'] }));
    expect(signals.groups().map((g) => g.id)).toEqual(['g']);
    expect(signals.nodes()).toBe(nodesBefore);
    const groupsBefore = signals.groups();
    editor.execute(commands.graphUpdate({ name: 'renamed' }));
    expect(signals.groups()).toBe(groupsBefore); // metadata touches no slice
  });

  it('refreshes every slice on unknown (plugin) command types', () => {
    const signals = createGraphSignals({ editor });
    const nodesBefore = signals.nodes();
    const edgesBefore = signals.edges();
    editor.execute(commands.zReorder('a', 5)); // 'z.reorder' — no known prefix
    expect(signals.nodes()).not.toBe(nodesBefore);
    expect(signals.edges()).not.toBe(edgesBefore);
  });

  it('destroy unsubscribes everything (leak test)', () => {
    const history = createHistory(editor);
    const signals = createGraphSignals({ editor, history });
    signals.destroy();
    addNode(editor, 'c');
    expect(signals.nodes().map((n) => n.id).sort()).toEqual(['a', 'b']); // frozen
    expect(signals.canUndo()).toBe(false);
    signals.destroy(); // idempotent
  });
});
