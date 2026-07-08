import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { ViewportController } from '@graphloom/rendering';
import { createHistory } from '@graphloom/history';
import { beforeEach, describe, expect, it } from 'vitest';
import { NO_MODIFIERS, type KeyInput } from './gestures.js';
import { actionFor, chordOf, contentBounds, createShortcutHandler } from './keymap.js';
import { Selection } from './selection.js';

const key = (k: string, mods: Partial<typeof NO_MODIFIERS> = {}): KeyInput => ({
  key: k,
  modifiers: { ...NO_MODIFIERS, ...mods },
});

describe('chordOf / actionFor', () => {
  it('normalizes order, case, and Mod (ctrl or meta — mac/win parity)', () => {
    expect(chordOf(key('z', { ctrl: true }))).toBe('Mod+Z');
    expect(chordOf(key('z', { meta: true }))).toBe('Mod+Z');
    expect(chordOf(key('Z', { shift: true, meta: true }))).toBe('Shift+Mod+Z');
    expect(actionFor(key('z', { ctrl: true }))).toBe('undo');
    expect(actionFor(key('z', { meta: true }))).toBe('undo');
    expect(actionFor(key('z', { shift: true, ctrl: true }))).toBe('redo');
    expect(actionFor(key('y', { ctrl: true }))).toBe('redo');
    expect(actionFor(key('q'))).toBeNull();
  });

  it('keymap is data: hosts can rebind', () => {
    expect(actionFor(key('d', { ctrl: true }), { 'Mod+D': 'duplicate' })).toBe('duplicate');
    expect(actionFor(key('z', { ctrl: true }), { 'Mod+D': 'duplicate' })).toBeNull();
  });
});

describe('createShortcutHandler', () => {
  let editor: GraphEditor;
  let selection: Selection;
  let viewport: ViewportController;

  beforeEach(() => {
    editor = createGraph();
    editor.execute(commands.nodeAdd({ id: 'a', position: { x: 10, y: 10 } }));
    editor.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 10 } }));
    editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
    selection = new Selection(editor);
    viewport = new ViewportController({ size: { width: 800, height: 600 } });
  });

  it('nudges a multi-selection as one history entry; shift = big step', () => {
    const history = createHistory(editor);
    const handle = createShortcutHandler({ editor, selection, viewport, history });
    selection.set(['a', 'b']);
    expect(handle(key('ArrowRight'))).toBe(true);
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 11, y: 10 });
    handle(key('ArrowDown', { shift: true }));
    expect(editor.graph.getNode('b')?.position).toEqual({ x: 201, y: 20 });
    history.undo(); // one entry per nudge, covering both nodes
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 11, y: 10 });
    history.undo();
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 10, y: 10 });
  });

  it('locked nodes do not nudge; empty selection is a no-op', () => {
    editor.execute(commands.nodeUpdate('b', { locked: true }));
    const history = createHistory(editor);
    const handle = createShortcutHandler({ editor, selection, viewport, history });
    handle(key('ArrowRight'));
    expect(history.canUndo).toBe(false);
    selection.set(['b']);
    handle(key('ArrowRight'));
    expect(editor.graph.getNode('b')?.position).toEqual({ x: 200, y: 10 });
    expect(history.canUndo).toBe(false);
  });

  it('delete removes selected edges and nodes atomically and undoes as one', () => {
    const history = createHistory(editor);
    const handle = createShortcutHandler({ editor, selection, viewport, history });
    selection.set(['a', 'ab']);
    handle(key('Delete'));
    expect(editor.graph.getNode('a')).toBeUndefined();
    expect(editor.graph.getEdge('ab')).toBeUndefined();
    history.undo();
    expect(editor.graph.getNode('a')).toBeDefined();
    expect(editor.graph.getEdge('ab')).toBeDefined();
    expect(history.canUndo).toBe(false);
  });

  it('undo/redo and select-all route to their services', () => {
    const history = createHistory(editor);
    const handle = createShortcutHandler({ editor, selection, viewport, history });
    selection.set(['a']);
    handle(key('Delete'));
    handle(key('z', { ctrl: true }));
    expect(editor.graph.getNode('a')).toBeDefined();
    handle(key('z', { shift: true, meta: true }));
    expect(editor.graph.getNode('a')).toBeUndefined();
    handle(key('z', { ctrl: true }));
    handle(key('a', { ctrl: true }));
    expect(selection.size).toBe(3);
  });

  it('escape cancels a gesture first, then clears selection', () => {
    let pending = true;
    const handle = createShortcutHandler({
      editor,
      selection,
      viewport,
      cancel: () => {
        const was = pending;
        pending = false;
        return was;
      },
    });
    selection.set(['a']);
    handle(key('Escape'));
    expect(selection.size).toBe(1); // gesture ate it
    handle(key('Escape'));
    expect(selection.size).toBe(0);
  });

  it('zoom in/out/fit drive the viewport', () => {
    const handle = createShortcutHandler({ editor, selection, viewport });
    handle(key('+'));
    expect(viewport.viewport.zoom).toBeCloseTo(2 ** 0.5);
    handle(key('-'));
    expect(viewport.viewport.zoom).toBeCloseTo(1);
    handle(key('0'));
    // Fit brings the content bounds (10,10)-(300,50) into view.
    const bounds = contentBounds(editor)!;
    const topLeft = viewport.worldToScreen({ x: bounds.x, y: bounds.y });
    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
  });

  it('unbound keys and unknown actions return false', () => {
    const handle = createShortcutHandler({ editor, selection, viewport }, { Q: 'not-a-thing' });
    expect(handle(key('x'))).toBe(false);
    expect(handle(key('Q'))).toBe(false);
  });

  it('contentBounds skips hidden nodes and is null when empty', () => {
    expect(contentBounds(createGraph())).toBeNull();
    editor.execute(commands.nodeUpdate('b', { hidden: true }));
    const bounds = contentBounds(editor)!;
    expect(bounds.x + bounds.width).toBeLessThan(200);
  });
});
