/**
 * Phase 4 exit scenario, headless (owner decision: zero DOM in this phase —
 * synthetic pointer/key sequences stand in for the examples-app e2e, which
 * is deferred with the demo wiring). A user creates nodes, connects them,
 * multi-selects, drags with snapping, resizes, copies/pastes — and undoes
 * every one of those actions.
 */
import { commands, createGraph } from '@graphloom/core';
import { createClipboard } from '@graphloom/clipboard';
import { createHistory } from '@graphloom/history';
import { SceneGraph, ViewportController } from '@graphloom/rendering';
import { describe, expect, it } from 'vitest';
import { InteractionEngine } from './engine.js';
import { NO_MODIFIERS, type PointerInput } from './gestures.js';

describe('Phase 4 integration: the full editing loop', () => {
  it('create → connect → select → drag+snap → resize → copy/paste → undo/redo everything', () => {
    const editor = createGraph();
    const history = createHistory(editor);
    const clipboard = createClipboard(editor);
    const viewport = new ViewportController({ size: { width: 800, height: 600 } });
    const scene = new SceneGraph(editor);
    const engine = new InteractionEngine({ editor, scene, viewport, history });

    let t = 0;
    const p = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
      pointerId: 1,
      point: { x, y },
      timestamp: (t += 20),
      modifiers: NO_MODIFIERS,
      ...extra,
    });
    const dragPointer = (from: [number, number], to: [number, number], steps = 3): void => {
      engine.pointerDown(p(...from));
      for (let i = 1; i <= steps; i++) {
        engine.pointerMove(
          p(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps),
        );
      }
      engine.pointerUp(p(...to));
    };

    // -- create: two nodes through the command boundary (the palette's job) --
    editor.execute(
      commands.nodeAdd({
        id: 'a',
        position: { x: 100, y: 100 },
        size: { width: 80, height: 40 },
        ports: [{ id: 'out', side: 'right' }],
      }),
    );
    editor.execute(
      commands.nodeAdd({
        id: 'b',
        position: { x: 400, y: 100 },
        size: { width: 80, height: 40 },
        ports: [{ id: 'in', side: 'left' }],
      }),
    );
    expect(editor.graph.nodeCount).toBe(2);
    history.undo();
    expect(editor.graph.nodeCount).toBe(1); // undo removes exactly the last create
    history.redo();
    expect(editor.graph.nodeCount).toBe(2);

    // -- connect: drag from a's out port (180,120) onto b ---------------------
    dragPointer([180, 120], [402, 118]);
    expect(editor.graph.edgeCount).toBe(1);
    const edge = editor.graph.edges()[0]!;
    expect(edge).toMatchObject({ source: 'a', target: 'b', sourcePort: 'out', targetPort: 'in' });
    history.undo();
    expect(editor.graph.edgeCount).toBe(0);
    history.redo();
    expect(editor.graph.edgeCount).toBe(1);

    // -- multi-select: marquee over both nodes --------------------------------
    dragPointer([50, 50], [520, 200]);
    expect([...engine.selection.ids()].sort()).toEqual(['a', 'b', editor.graph.edges()[0]!.id].sort());

    // -- drag: move the multi-selection; one history entry; undo restores ----
    dragPointer([140, 120], [173, 155]); // grab node a's body; raw offset (33,35)
    // Snapping is active (default grid 20): the selection-bounds center snaps
    // in x (323→320 ⇒ −3) and the top edge in y (135→140 ⇒ +5).
    expect(editor.graph.getNode('a')!.position).toEqual({ x: 130, y: 140 });
    expect(editor.graph.getNode('b')!.position).toEqual({ x: 430, y: 140 });
    history.undo(); // ONE undo restores both nodes
    expect(editor.graph.getNode('a')!.position).toEqual({ x: 100, y: 100 });
    expect(editor.graph.getNode('b')!.position).toEqual({ x: 400, y: 100 });

    // -- ESC aborts a drag with zero model change ------------------------------
    engine.pointerDown(p(140, 120));
    engine.pointerMove(p(200, 200));
    expect(engine.drag.active).toBe(true);
    expect(engine.key({ key: 'Escape', modifiers: NO_MODIFIERS })).toBe(true);
    expect(engine.drag.active).toBe(false);
    engine.pointerUp(p(200, 200)); // release after abort: still nothing
    expect(editor.graph.getNode('a')!.position).toEqual({ x: 100, y: 100 });

    // -- resize: select a alone, pull its SE handle ---------------------------
    engine.pointerDown(p(140, 120));
    engine.pointerUp(p(140, 120)); // tap selects a
    expect(engine.selection.ids()).toEqual(['a']);
    dragPointer([180, 140], [220, 170]); // SE corner outward
    expect(editor.graph.getNode('a')!.size).toEqual({ width: 120, height: 70 });
    history.undo();
    expect(editor.graph.getNode('a')!.size).toEqual({ width: 80, height: 40 });

    // -- keyboard: nudge, select-all, delete, undo ----------------------------
    engine.key({ key: 'ArrowRight', modifiers: { ...NO_MODIFIERS, shift: true } });
    expect(editor.graph.getNode('a')!.position.x).toBe(110);
    history.undo();
    engine.key({ key: 'a', modifiers: { ...NO_MODIFIERS, ctrl: true } });
    expect(engine.selection.size).toBe(3);

    // -- copy/paste: one undoable transaction, edges remapped ------------------
    const pasted = clipboard.paste(clipboard.copy(engine.selection.ids())!);
    expect(pasted).toHaveLength(3); // 2 nodes + 1 internal edge
    expect(editor.graph.nodeCount).toBe(4);
    expect(editor.graph.edgeCount).toBe(2);
    history.undo(); // one entry for the whole paste
    expect(editor.graph.nodeCount).toBe(2);
    expect(editor.graph.edgeCount).toBe(1);
    history.redo();
    expect(editor.graph.nodeCount).toBe(4);

    // -- pan & zoom: wheel about a point, space+drag pans ----------------------
    const anchorWorld = viewport.screenToWorld({ x: 300, y: 200 });
    engine.wheel({ point: { x: 300, y: 200 }, deltaY: -100 });
    expect(viewport.viewport.zoom).toBeGreaterThan(1);
    expect(viewport.screenToWorld({ x: 300, y: 200 }).x).toBeCloseTo(anchorWorld.x);
    engine.panMode = true; // space held
    const beforePan = viewport.viewport;
    dragPointer([300, 300], [350, 320]);
    expect(viewport.viewport.x - beforePan.x).toBeCloseTo(50);
    expect(viewport.viewport.y - beforePan.y).toBeCloseTo(20);
    engine.panMode = false;
    expect(editor.graph.nodeCount).toBe(4); // panning never touched the model

    // -- context menu: right-click a node produces a typed request -------------
    const requests: unknown[] = [];
    engine.on('contextmenu.requested', ({ request }) => requests.push(request.target));
    engine.selection.clear(); // a multi-selection hit would be a 'selection' target
    engine.key({ key: '0', modifiers: NO_MODIFIERS }); // zoom-to-fit first
    const aNode = editor.graph.getNode('a')!;
    const aCenter = viewport.worldToScreen({
      x: aNode.position.x + aNode.size.width / 2,
      y: aNode.position.y + aNode.size.height / 2,
    });
    engine.pointerDown(p(aCenter.x, aCenter.y, { button: 2 }));
    engine.pointerUp(p(aCenter.x, aCenter.y, { button: 2 }));
    expect(requests).toEqual([{ kind: 'node', id: 'a' }]);
  });
});
