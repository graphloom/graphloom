import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { ViewportController } from '@graphloom/rendering';
import { createHistory } from '@graphloom/history';
import { beforeEach, describe, expect, it } from 'vitest';
import { DragController } from './drag.js';
import { NO_MODIFIERS } from './gestures.js';

let editor: GraphEditor;
let viewport: ViewportController;

beforeEach(() => {
  editor = createGraph();
  viewport = new ViewportController({ size: { width: 800, height: 600 } });
  editor.execute(commands.nodeAdd({ id: 'a', position: { x: 10, y: 10 } }));
  editor.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 10 } }));
  editor.execute(commands.nodeAdd({ id: 'locked', position: { x: 0, y: 200 }, locked: true }));
});

describe('DragController', () => {
  it('previews without touching the model; end commits one history entry', () => {
    const history = createHistory(editor);
    const drag = new DragController(editor, viewport, { autoPanMargin: 0 });
    expect(drag.begin(['a', 'b'], { x: 0, y: 0 })).toBe(true);
    drag.move({ x: 30, y: 40 });
    expect(drag.preview.get('a')).toEqual({ x: 40, y: 50 });
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 10, y: 10 }); // untouched
    drag.end();
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 40, y: 50 });
    expect(editor.graph.getNode('b')?.position).toEqual({ x: 230, y: 50 });
    expect(drag.preview.size).toBe(0);
    // One entry for the whole multi-node gesture (ADR-0001).
    expect(history.undo()).toBe(true);
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 10, y: 10 });
    expect(editor.graph.getNode('b')?.position).toEqual({ x: 200, y: 10 });
    expect(history.canUndo).toBe(false);
  });

  it('cancel leaves the model untouched and clears the preview', () => {
    const drag = new DragController(editor, viewport, { autoPanMargin: 0 });
    const previews: number[] = [];
    drag.on('drag.preview', ({ positions }) => previews.push(positions.size));
    drag.begin(['a'], { x: 0, y: 0 });
    drag.move({ x: 100, y: 0 });
    drag.cancel();
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 10, y: 10 });
    expect(previews).toEqual([1, 0]);
    drag.end(); // after cancel: no-op
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 10, y: 10 });
  });

  it('drag respects zoom (screen delta ÷ zoom = world delta)', () => {
    viewport.setViewport({ x: 0, y: 0, zoom: 2 });
    const drag = new DragController(editor, viewport, { autoPanMargin: 0 });
    drag.begin(['a'], { x: 0, y: 0 });
    drag.move({ x: 50, y: 0 });
    expect(drag.preview.get('a')).toEqual({ x: 35, y: 10 });
    drag.cancel();
  });

  it('locked nodes are immovable; all-locked drag never starts', () => {
    const drag = new DragController(editor, viewport, { autoPanMargin: 0 });
    expect(drag.begin(['locked'], { x: 0, y: 0 })).toBe(false);
    expect(drag.begin(['a', 'locked'], { x: 0, y: 0 })).toBe(true);
    drag.move({ x: 20, y: 0 });
    drag.end();
    expect(editor.graph.getNode('locked')?.position).toEqual({ x: 0, y: 200 });
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 30, y: 10 });
  });

  it('no-movement release commits nothing', () => {
    const history = createHistory(editor);
    const drag = new DragController(editor, viewport, { autoPanMargin: 0 });
    drag.begin(['a'], { x: 0, y: 0 });
    drag.move({ x: 0, y: 0 });
    drag.end();
    expect(history.canUndo).toBe(false);
  });

  it('auto-pans at viewport edges and the node follows', () => {
    const drag = new DragController(editor, viewport, { autoPanMargin: 24 });
    drag.begin(['a'], { x: 400, y: 300 });
    drag.move({ x: 790, y: 300 }); // 14px past the right margin
    expect(viewport.viewport.x).toBe(-14);
    // World position under the pointer includes the panned distance.
    expect(drag.preview.get('a')?.x).toBeCloseTo(10 + (790 - 400) + 14);
    drag.cancel();
  });

  it('snap provider adjusts the offset unless alt disables it', () => {
    const drag = new DragController(editor, viewport, {
      autoPanMargin: 0,
      snap: (offset, ctx) =>
        ctx.disabled ? offset : { x: Math.round(offset.x / 10) * 10, y: 0 },
    });
    drag.begin(['a'], { x: 0, y: 0 });
    drag.move({ x: 13, y: 7 });
    expect(drag.preview.get('a')).toEqual({ x: 20, y: 10 });
    drag.move({ x: 13, y: 7 }, { ...NO_MODIFIERS, alt: true });
    expect(drag.preview.get('a')).toEqual({ x: 23, y: 17 });
    drag.cancel();
  });

  it('move/end without begin are safe no-ops', () => {
    const drag = new DragController(editor, viewport, { autoPanMargin: 0 });
    drag.move({ x: 5, y: 5 });
    drag.end();
    expect(drag.active).toBe(false);
  });
});
