import { commands, createGraph, type GraphEditor, type Node } from '@graphloom/core';
import { ViewportController } from '@graphloom/rendering';
import { createHistory } from '@graphloom/history';
import { beforeEach, describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from './gestures.js';
import {
  handlePositions,
  resizeNode,
  rotateNode,
  TransformController,
  type NodeTransform,
} from './transform.js';

const box = (rotation = 0): NodeTransform => ({
  position: { x: 100, y: 100 },
  size: { width: 80, height: 40 },
  rotation,
});

describe('handlePositions', () => {
  it('places the 8 handles on the unrotated rect', () => {
    const h = handlePositions(box());
    expect(h.nw).toEqual({ x: 100, y: 100 });
    expect(h.se).toEqual({ x: 180, y: 140 });
    expect(h.n).toEqual({ x: 140, y: 100 });
    expect(h.rotate).toEqual({ x: 140, y: 76 });
  });

  it('rotates handles about the node center', () => {
    const h = handlePositions(box(90));
    // Center (140,120); nw (100,100) → rotated 90° cw → (160, 80).
    expect(h.nw.x).toBeCloseTo(160);
    expect(h.nw.y).toBeCloseTo(80);
  });
});

describe('resizeNode', () => {
  it('se drag resizes with nw anchored', () => {
    const t = resizeNode(box(), 'se', { x: 200, y: 160 });
    expect(t.position).toEqual({ x: 100, y: 100 });
    expect(t.size).toEqual({ width: 100, height: 60 });
  });

  it('edge handle changes only its axis', () => {
    const t = resizeNode(box(), 'e', { x: 220, y: 999 });
    expect(t.size).toEqual({ width: 120, height: 40 });
    expect(t.position).toEqual({ x: 100, y: 100 });
  });

  it('resize of a rotated node keeps the anchor fixed in world space (classic bug)', () => {
    const start = box(30);
    const before = handlePositions(start);
    // Drag the east handle outward along its world direction.
    const t = resizeNode(start, 'e', { x: before.e.x + 30, y: before.e.y + 10 });
    const after = handlePositions(t);
    // The opposite (west) handle must not move.
    expect(after.w.x).toBeCloseTo(before.w.x);
    expect(after.w.y).toBeCloseTo(before.w.y);
    expect(t.rotation).toBe(30);
    expect(t.size.height).toBe(40);
    expect(t.size.width).toBeGreaterThan(80);
  });

  it('shift locks aspect ratio', () => {
    const t = resizeNode(box(), 'se', { x: 260, y: 120 }, { aspect: true });
    expect(t.size.width / t.size.height).toBeCloseTo(2);
    expect(t.size.width).toBe(160); // dominant axis wins
  });

  it('alt resizes about the center', () => {
    const t = resizeNode(box(), 'e', { x: 200, y: 120 }, { centered: true });
    expect(t.size.width).toBe(120);
    // Center unchanged.
    expect(t.position.x + t.size.width / 2).toBe(140);
    expect(t.position.y + t.size.height / 2).toBe(120);
  });

  it('clamps to min and max size instead of flipping', () => {
    const min = resizeNode(box(), 'se', { x: 90, y: 90 });
    expect(min.size).toEqual({ width: 10, height: 10 });
    const max = resizeNode(box(), 'se', { x: 9999, y: 9999 }, {}, { maxSize: 200 });
    expect(max.size).toEqual({ width: 200, height: 200 });
  });
});

describe('rotateNode', () => {
  it('rotates by the angle swept from the grab point', () => {
    const start = box(); // center (140,120)
    const t = rotateNode(start, { x: 140, y: 76 }, { x: 184, y: 120 }, false);
    expect(t.rotation).toBeCloseTo(90);
    expect(t.position).toEqual(start.position);
  });

  it('shift snaps to 15° and rotation normalizes to [0,360)', () => {
    const t = rotateNode(box(350), { x: 140, y: 76 }, { x: 148, y: 77 }, true);
    expect(t.rotation % 15).toBe(0);
    expect(t.rotation).toBeGreaterThanOrEqual(0);
    expect(t.rotation).toBeLessThan(360);
  });
});

describe('TransformController', () => {
  let editor: GraphEditor;
  let viewport: ViewportController;
  let node: Node;

  beforeEach(() => {
    editor = createGraph();
    viewport = new ViewportController({ size: { width: 800, height: 600 } });
    editor.execute(
      commands.nodeAdd({ id: 'n', position: { x: 100, y: 100 }, size: { width: 80, height: 40 } }),
    );
    node = editor.graph.getNode('n')!;
  });

  it('previews ephemerally and commits one history entry', () => {
    const history = createHistory(editor);
    const tc = new TransformController(editor, viewport);
    expect(tc.begin(node, 'se', { x: 180, y: 140 })).toBe(true);
    tc.move({ x: 200, y: 160 }, NO_MODIFIERS);
    expect(editor.graph.getNode('n')?.size).toEqual({ width: 80, height: 40 });
    tc.end();
    expect(editor.graph.getNode('n')?.size).toEqual({ width: 100, height: 60 });
    history.undo();
    expect(editor.graph.getNode('n')?.size).toEqual({ width: 80, height: 40 });
    expect(history.canUndo).toBe(false);
  });

  it('cancel discards the preview and emits null', () => {
    const tc = new TransformController(editor, viewport);
    const events: (NodeTransform | null)[] = [];
    tc.on('transform.preview', ({ transform }) => events.push(transform));
    tc.begin(node, 'rotate', { x: 140, y: 76 });
    tc.move({ x: 184, y: 120 });
    tc.cancel();
    expect(editor.graph.getNode('n')?.rotation).toBe(0);
    expect(events.at(-1)).toBeNull();
    tc.end(); // no-op after cancel
    expect(editor.graph.getNode('n')?.rotation).toBe(0);
  });

  it('rejects locked nodes and ignores move/end when idle', () => {
    editor.execute(commands.nodeUpdate('n', { locked: true }));
    const tc = new TransformController(editor, viewport);
    expect(tc.begin(editor.graph.getNode('n')!, 'se', { x: 0, y: 0 })).toBe(false);
    tc.move({ x: 10, y: 10 });
    tc.end();
    expect(tc.active).toBe(false);
  });
});
