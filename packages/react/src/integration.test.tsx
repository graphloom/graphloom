/**
 * Phase 6 exit scenario, headless (owner decision — Decision Log): the full
 * P4 editing loop runs through <Graph>'s wiring under StrictMode, and every
 * assertion reads the hook surface, proving editor → engine → store → hooks
 * end to end with zero React warnings. The React demo app + browser e2e are
 * the deferred close-out, mirroring P5.
 */
import { commands, createGraph, type GraphSnapshot, type Viewport } from '@graphloom/core';
import { NO_MODIFIERS, type PointerInput } from '@graphloom/interaction';
import { act, render } from '@testing-library/react';
import { StrictMode, createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Graph, type GraphHandle } from './graph.js';
import { useGraph, useSelection, useUndoRedo, useViewport } from './hooks.js';

const makeDocument = (): GraphSnapshot => {
  const scratch = createGraph();
  scratch.transact(() => {
    scratch.execute(
      commands.nodeAdd({
        id: 'a',
        position: { x: 100, y: 100 },
        size: { width: 80, height: 40 },
        ports: [{ id: 'out', side: 'right' }],
      }),
    );
    scratch.execute(
      commands.nodeAdd({
        id: 'b',
        position: { x: 400, y: 100 },
        size: { width: 80, height: 40 },
        ports: [{ id: 'in', side: 'left' }],
      }),
    );
  });
  return scratch.snapshot();
};

interface Box {
  nodes: ReturnType<typeof useGraph>['nodes'];
  edges: ReturnType<typeof useGraph>['edges'];
  selection: readonly string[];
  viewport: Viewport;
  canUndo: boolean;
}

describe('Phase 6 integration: the editing loop through <Graph> under StrictMode', () => {
  it('select → connect → drag+snap → keys → copy/paste → pan/zoom → menu, undo per gesture', () => {
    const consoleError = vi.spyOn(console, 'error').mockImplementation(() => {});
    const consoleWarn = vi.spyOn(console, 'warn').mockImplementation(() => {});

    const box = {} as Box;
    const Probe = (): null => {
      const { nodes, edges } = useGraph();
      box.nodes = nodes;
      box.edges = edges;
      box.selection = useSelection();
      box.viewport = useViewport();
      box.canUndo = useUndoRedo().canUndo;
      return null;
    };
    const ref = createRef<GraphHandle>();
    const targets: unknown[] = [];
    const { container } = render(
      <StrictMode>
        <Graph
          ref={ref}
          document={makeDocument()}
          options={{ mount: { viewport: { size: { width: 800, height: 600 } } } }}
          onContextMenu={(request) => targets.push(request.target)}
        >
          <Probe />
        </Graph>
      </StrictMode>,
    );

    const engine = ref.current!.engine!;
    const history = ref.current!.history!;
    const clipboard = ref.current!.clipboard!;
    const viewport = ref.current!.host!.viewport;

    let t = 0;
    const p = (x: number, y: number, extra: Partial<PointerInput> = {}): PointerInput => ({
      pointerId: 1,
      point: { x, y },
      timestamp: (t += 20),
      modifiers: NO_MODIFIERS,
      ...extra,
    });
    const dragPointer = (from: [number, number], to: [number, number], steps = 3): void => {
      act(() => {
        engine.pointerDown(p(...from));
        for (let i = 1; i <= steps; i++) {
          engine.pointerMove(
            p(from[0] + ((to[0] - from[0]) * i) / steps, from[1] + ((to[1] - from[1]) * i) / steps),
          );
        }
        engine.pointerUp(p(...to));
      });
    };
    const undo = (): void => act(() => void history.undo());
    const redo = (): void => act(() => void history.redo());

    // -- the document arrived through the prop; history starts clean ---------
    expect(box.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(box.canUndo).toBe(false);

    // -- tap select via a REAL DOM event (proves attachInteraction ran) ------
    const canvas = container.querySelector('[data-graphloom-canvas]') as HTMLElement;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const tap = (type: string, x: number, y: number): void => {
      act(() => {
        const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
        Object.defineProperty(event, 'pointerId', { value: 1 });
        Object.defineProperty(event, 'pointerType', { value: 'mouse' });
        canvas.dispatchEvent(event);
      });
    };
    tap('pointerdown', 140, 120);
    tap('pointerup', 140, 120);
    expect(box.selection).toEqual(['a']);
    act(() => {
      engine.selection.clear(); // a stays selected → its E resize handle would sit on the port
    });

    // -- connect: drag from a's out port onto b; one entry; undoable ---------
    dragPointer([180, 120], [402, 118]);
    expect(box.edges).toHaveLength(1);
    expect(box.edges[0]).toMatchObject({
      source: 'a',
      target: 'b',
      sourcePort: 'out',
      targetPort: 'in',
    });
    expect(box.canUndo).toBe(true);
    undo();
    expect(box.edges).toHaveLength(0);
    redo();

    // -- marquee multi-select over everything ---------------------------------
    dragPointer([50, 50], [520, 200]);
    expect([...box.selection].sort()).toEqual(['a', 'b', box.edges[0]!.id].sort());

    // -- multi-drag with snapping; ONE undo restores both ---------------------
    dragPointer([140, 120], [173, 155]);
    const nodeById = (id: string) => box.nodes.find((n) => n.id === id)!;
    expect(nodeById('a').position).toEqual({ x: 130, y: 140 });
    expect(nodeById('b').position).toEqual({ x: 430, y: 140 });
    undo();
    expect(nodeById('a').position).toEqual({ x: 100, y: 100 });
    expect(nodeById('b').position).toEqual({ x: 400, y: 100 });

    // -- ESC aborts a drag with zero model change ------------------------------
    act(() => {
      engine.pointerDown(p(140, 120));
      engine.pointerMove(p(200, 200));
      expect(engine.key({ key: 'Escape', modifiers: NO_MODIFIERS })).toBe(true);
      engine.pointerUp(p(200, 200));
    });
    expect(nodeById('a').position).toEqual({ x: 100, y: 100 });

    // -- keyboard: nudge with undo, select-all, delete with undo --------------
    act(() => {
      engine.pointerDown(p(140, 120));
      engine.pointerUp(p(140, 120));
      engine.key({ key: 'ArrowRight', modifiers: { ...NO_MODIFIERS, shift: true } });
    });
    expect(nodeById('a').position.x).toBe(110);
    undo();
    expect(nodeById('a').position.x).toBe(100);
    act(() => {
      engine.key({ key: 'a', modifiers: { ...NO_MODIFIERS, ctrl: true } });
      engine.key({ key: 'Delete', modifiers: NO_MODIFIERS });
    });
    expect(box.nodes).toEqual([]);
    expect(box.edges).toEqual([]);
    undo(); // one entry restores the whole selection
    expect(box.nodes).toHaveLength(2);
    expect(box.edges).toHaveLength(1);

    // -- copy/paste through the component's clipboard; one undoable entry -----
    act(() => {
      engine.key({ key: 'a', modifiers: { ...NO_MODIFIERS, ctrl: true } });
    });
    act(() => {
      const pasted = clipboard.paste(clipboard.copy(engine.selection.ids())!);
      expect(pasted).toHaveLength(3); // 2 nodes + internal edge
    });
    expect(box.nodes).toHaveLength(4);
    undo();
    expect(box.nodes).toHaveLength(2);

    // -- pan & zoom reach the viewport hook ------------------------------------
    act(() => {
      engine.wheel({ point: { x: 300, y: 200 }, deltaY: -100 });
    });
    expect(box.viewport.zoom).toBeGreaterThan(1);
    engine.panMode = true;
    const before = box.viewport;
    dragPointer([300, 300], [350, 320]);
    expect(box.viewport.x - before.x).toBeCloseTo(50);
    engine.panMode = false;
    expect(box.nodes).toHaveLength(2); // panning never touched the model

    // -- context menu surfaces as a callback prop -------------------------------
    act(() => {
      engine.selection.clear();
    });
    const a = nodeById('a');
    const center = viewport.worldToScreen({
      x: a.position.x + a.size.width / 2,
      y: a.position.y + a.size.height / 2,
    });
    act(() => {
      engine.pointerDown(p(center.x, center.y, { button: 2 }));
      engine.pointerUp(p(center.x, center.y, { button: 2 }));
    });
    expect(targets).toEqual([{ kind: 'node', id: 'a' }]);

    // -- StrictMode ran the whole loop without a single React warning ----------
    expect(consoleError).not.toHaveBeenCalled();
    expect(consoleWarn).not.toHaveBeenCalled();
    consoleError.mockRestore();
    consoleWarn.mockRestore();
  });
});
