// @vitest-environment jsdom
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { SceneGraph, ViewportController } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import { attachInteraction } from './dom.js';
import { InteractionEngine } from './engine.js';

let editor: GraphEditor;
let engine: InteractionEngine;
let element: HTMLElement;
let viewport: ViewportController;
let detach: () => void;

/** jsdom has no PointerEvent — a MouseEvent with pointer fields glued on. */
const pointerEvent = (
  type: string,
  init: MouseEventInit & { pointerId?: number; pointerType?: string },
): Event => {
  const e = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(e, 'pointerId', { value: init.pointerId ?? 1 });
  Object.defineProperty(e, 'pointerType', { value: init.pointerType ?? 'mouse' });
  return e;
};

beforeEach(() => {
  editor = createGraph();
  editor.execute(
    commands.nodeAdd({ id: 'a', position: { x: 100, y: 100 }, size: { width: 80, height: 40 } }),
  );
  element = document.createElement('div');
  element.getBoundingClientRect = () =>
    ({ left: 10, top: 20, width: 800, height: 600 }) as DOMRect;
  document.body.appendChild(element);
  viewport = new ViewportController({ size: { width: 800, height: 600 } });
  engine = new InteractionEngine({ editor, scene: new SceneGraph(editor), viewport });
  detach = attachInteraction(engine, element);
});

describe('attachInteraction', () => {
  it('routes pointer events with element-relative coordinates (tap selects)', () => {
    // Node center (140,120 world = screen) + element offset (10,20).
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 150, clientY: 140 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 140 }));
    expect(engine.selection.ids()).toEqual(['a']);
  });

  it('routes a drag end-to-end (node moves, one commit)', () => {
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 150, clientY: 140 }));
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 190, clientY: 140 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 190, clientY: 140 }));
    expect(editor.graph.getNode('a')?.position.x).toBeGreaterThan(100);
  });

  it('pointercancel aborts without committing', () => {
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 150, clientY: 140 }));
    element.dispatchEvent(pointerEvent('pointermove', { clientX: 400, clientY: 140 }));
    element.dispatchEvent(pointerEvent('pointercancel', { clientX: 400, clientY: 140 }));
    expect(editor.graph.getNode('a')?.position).toEqual({ x: 100, y: 100 });
  });

  it('wheel zooms (prevented default) and normalizes line-mode deltas', () => {
    const e = new WheelEvent('wheel', { clientX: 410, clientY: 320, deltaY: -100, cancelable: true });
    element.dispatchEvent(e);
    expect(e.defaultPrevented).toBe(true);
    expect(viewport.viewport.zoom).toBeCloseTo(2 ** 0.2);

    const lines = new WheelEvent('wheel', { clientX: 410, clientY: 320, deltaY: -5, cancelable: true });
    Object.defineProperty(lines, 'deltaMode', { value: 1 });
    element.dispatchEvent(lines);
    expect(viewport.viewport.zoom).toBeCloseTo(2 ** 0.2 * 2 ** (5 * 16 * 0.002)); // 5 lines × 16 px
  });

  it('keyboard routes through the engine unless a text input has focus', () => {
    engine.selection.set(['a']);
    const del = new KeyboardEvent('keydown', { key: 'Delete', cancelable: true });
    window.dispatchEvent(del);
    expect(editor.graph.getNode('a')).toBeUndefined();
    expect(del.defaultPrevented).toBe(true);

    // Focused text input eats the key.
    const input = document.createElement('input');
    document.body.appendChild(input);
    const typed = new KeyboardEvent('keydown', { key: 'z', ctrlKey: true, cancelable: true });
    Object.defineProperty(typed, 'target', { value: input });
    window.dispatchEvent(typed);
    expect(editor.graph.getNode('a')).toBeUndefined(); // undo did NOT run
  });

  it('space toggles pan mode down/up and never scrolls', () => {
    const down = new KeyboardEvent('keydown', { key: ' ', cancelable: true });
    window.dispatchEvent(down);
    expect(engine.panMode).toBe(true);
    expect(down.defaultPrevented).toBe(true);
    window.dispatchEvent(new KeyboardEvent('keyup', { key: ' ' }));
    expect(engine.panMode).toBe(false);
  });

  it('suppresses the native context menu', () => {
    const menu = new MouseEvent('contextmenu', { cancelable: true, bubbles: true });
    element.dispatchEvent(menu);
    expect(menu.defaultPrevented).toBe(true);
  });

  it('detach removes every listener', () => {
    detach();
    element.dispatchEvent(pointerEvent('pointerdown', { clientX: 150, clientY: 140 }));
    element.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 140 }));
    expect(engine.selection.size).toBe(0);
    window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' }));
    expect(engine.panMode).toBe(false);
  });
});
