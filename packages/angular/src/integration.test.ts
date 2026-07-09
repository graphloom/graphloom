/**
 * Phase 5 exit scenario, headless (owner decision — Decision Log): the full
 * P4 editing loop runs through the Angular component's wiring, and every
 * assertion reads the component's signal surface, proving editor → engine →
 * bridge → signals end to end. The Angular demo app + browser e2e are the
 * deferred close-out, mirroring P4-T11.
 */
import { provideZonelessChangeDetection } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { commands, createGraph, type GraphSnapshot } from '@graphloom/core';
import { NO_MODIFIERS, type PointerInput } from '@graphloom/interaction';
import { describe, expect, it } from 'vitest';
import { GraphComponent } from './graph.component.js';

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

describe('Phase 5 integration: the editing loop through <graphloom-graph>', () => {
  it('select → connect → drag+snap → keys → copy/paste → pan/zoom → menu, undo per gesture', () => {
    TestBed.configureTestingModule({ providers: [provideZonelessChangeDetection()] });
    const fixture = TestBed.createComponent(GraphComponent);
    fixture.componentRef.setInput('document', makeDocument());
    fixture.detectChanges();
    TestBed.tick();

    const component = fixture.componentInstance;
    const engine = component.engine()!;
    const history = component.history()!;
    const clipboard = component.clipboard()!;
    const viewport = component.host()!.viewport;
    viewport.setSize({ width: 800, height: 600 }); // jsdom hosts measure 0×0

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

    // -- the document arrived through the input; history starts clean --------
    expect(component.nodes().map((n) => n.id).sort()).toEqual(['a', 'b']);
    expect(component.canUndo()).toBe(false);

    // -- tap select via a REAL DOM event (proves attachInteraction ran) ------
    const canvas = fixture.nativeElement.querySelector('.graphloom-canvas') as HTMLElement;
    canvas.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 800, height: 600 }) as DOMRect;
    const tap = (type: string, x: number, y: number): void => {
      const event = new MouseEvent(type, { bubbles: true, clientX: x, clientY: y });
      Object.defineProperty(event, 'pointerId', { value: 1 });
      Object.defineProperty(event, 'pointerType', { value: 'mouse' });
      canvas.dispatchEvent(event);
    };
    tap('pointerdown', 140, 120);
    tap('pointerup', 140, 120);
    expect(component.selection()).toEqual(['a']);
    engine.selection.clear(); // a stays selected → its E resize handle would sit on the port

    // -- connect: drag from a's out port onto b; one entry; undoable ---------
    dragPointer([180, 120], [402, 118]);
    expect(component.edges()).toHaveLength(1);
    expect(component.edges()[0]).toMatchObject({
      source: 'a',
      target: 'b',
      sourcePort: 'out',
      targetPort: 'in',
    });
    expect(component.canUndo()).toBe(true);
    history.undo();
    expect(component.edges()).toHaveLength(0);
    history.redo();

    // -- marquee multi-select over everything ---------------------------------
    dragPointer([50, 50], [520, 200]);
    expect([...component.selection()].sort()).toEqual(
      ['a', 'b', component.edges()[0]!.id].sort(),
    );

    // -- multi-drag with snapping; ONE undo restores both ---------------------
    dragPointer([140, 120], [173, 155]);
    const nodeById = (id: string) => component.nodes().find((n) => n.id === id)!;
    expect(nodeById('a').position).toEqual({ x: 130, y: 140 });
    expect(nodeById('b').position).toEqual({ x: 430, y: 140 });
    history.undo();
    expect(nodeById('a').position).toEqual({ x: 100, y: 100 });
    expect(nodeById('b').position).toEqual({ x: 400, y: 100 });

    // -- ESC aborts a drag with zero model change ------------------------------
    engine.pointerDown(p(140, 120));
    engine.pointerMove(p(200, 200));
    expect(engine.key({ key: 'Escape', modifiers: NO_MODIFIERS })).toBe(true);
    engine.pointerUp(p(200, 200));
    expect(nodeById('a').position).toEqual({ x: 100, y: 100 });

    // -- keyboard: nudge with undo, select-all, delete with undo --------------
    engine.pointerDown(p(140, 120));
    engine.pointerUp(p(140, 120));
    engine.key({ key: 'ArrowRight', modifiers: { ...NO_MODIFIERS, shift: true } });
    expect(nodeById('a').position.x).toBe(110);
    history.undo();
    expect(nodeById('a').position.x).toBe(100);
    engine.key({ key: 'a', modifiers: { ...NO_MODIFIERS, ctrl: true } });
    engine.key({ key: 'Delete', modifiers: NO_MODIFIERS });
    expect(component.nodes()).toEqual([]);
    expect(component.edges()).toEqual([]);
    history.undo(); // one entry restores the whole selection
    expect(component.nodes()).toHaveLength(2);
    expect(component.edges()).toHaveLength(1);

    // -- copy/paste through the component's clipboard; one undoable entry -----
    engine.key({ key: 'a', modifiers: { ...NO_MODIFIERS, ctrl: true } });
    const pasted = clipboard.paste(clipboard.copy(engine.selection.ids())!);
    expect(pasted).toHaveLength(3); // 2 nodes + internal edge
    expect(component.nodes()).toHaveLength(4);
    history.undo();
    expect(component.nodes()).toHaveLength(2);

    // -- pan & zoom reach the viewport signal ----------------------------------
    engine.wheel({ point: { x: 300, y: 200 }, deltaY: -100 });
    expect(component.viewport().zoom).toBeGreaterThan(1);
    engine.panMode = true;
    const before = component.viewport();
    dragPointer([300, 300], [350, 320]);
    expect(component.viewport().x - before.x).toBeCloseTo(50);
    engine.panMode = false;
    expect(component.nodes()).toHaveLength(2); // panning never touched the model

    // -- context menu surfaces as a component output ---------------------------
    const targets: unknown[] = [];
    component.contextMenu.subscribe((request) => targets.push(request.target));
    engine.selection.clear();
    const a = nodeById('a');
    const center = viewport.worldToScreen({
      x: a.position.x + a.size.width / 2,
      y: a.position.y + a.size.height / 2,
    });
    engine.pointerDown(p(center.x, center.y, { button: 2 }));
    engine.pointerUp(p(center.x, center.y, { button: 2 }));
    expect(targets).toEqual([{ kind: 'node', id: 'a' }]);
  });
});
