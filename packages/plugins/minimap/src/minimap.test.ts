// @vitest-environment jsdom
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { mountRenderer, createSvgRenderer, type RenderHost } from '@graphloom/rendering';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createMinimap } from './minimap.js';

/** jsdom has no PointerEvent — a MouseEvent with pointer fields glued on. */
const pointerEvent = (type: string, init: MouseEventInit): Event => {
  const e = new MouseEvent(type, { bubbles: true, ...init });
  Object.defineProperty(e, 'pointerId', { value: 1 });
  return e;
};

const sized = (w: number, h: number): HTMLElement => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  document.body.appendChild(el);
  return el;
};

interface World {
  editor: GraphEditor;
  host: RenderHost;
  hostEl: HTMLElement;
  mount: HTMLElement;
}

const setup = (): World => {
  const editor = createGraph();
  editor.transact(() => {
    editor.execute(
      commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 }, size: { width: 100, height: 60 } }),
    );
    editor.execute(
      commands.nodeAdd({ id: 'b', position: { x: 900, y: 600 }, size: { width: 100, height: 60 } }),
    );
  });
  const hostEl = sized(800, 600);
  const host = mountRenderer(editor, createSvgRenderer(), hostEl);
  return { editor, host, hostEl, mount: sized(200, 150) };
};

describe('createMinimap', () => {
  let world: World;
  const watch = (editor: GraphEditor) => (cb: () => void) => editor.on('graph.change', cb);

  beforeEach(() => {
    world = setup();
  });

  afterEach(() => {
    world.host.destroy();
    world.hostEl.remove();
    world.mount.remove();
    vi.restoreAllMocks();
  });

  it('fits the whole graph inside the minimap box', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });

    const bounds = host.scene.bounds()!;
    const topLeft = mm.viewport.worldToScreen({ x: bounds.x, y: bounds.y });
    const bottomRight = mm.viewport.worldToScreen({
      x: bounds.x + bounds.width,
      y: bounds.y + bounds.height,
    });

    expect(topLeft.x).toBeGreaterThanOrEqual(0);
    expect(topLeft.y).toBeGreaterThanOrEqual(0);
    expect(bottomRight.x).toBeLessThanOrEqual(200);
    expect(bottomRight.y).toBeLessThanOrEqual(150);

    mm.destroy();
  });

  it('mounts one canvas into the given element and removes it on destroy', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });
    expect(mount.querySelector('canvas')).not.toBeNull();
    mm.destroy();
    expect(mount.querySelector('canvas')).toBeNull();
    expect(mount.childNodes).toHaveLength(0);
  });

  it('positions the indicator over the main viewport and tracks its changes', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });
    const indicator = mount.querySelector<HTMLElement>('[data-graphloom="minimap-indicator"]');
    expect(indicator).not.toBeNull();

    const assertMatchesHost = (): void => {
      const w = host.viewport.visibleWorldRect();
      const tl = mm.viewport.worldToScreen({ x: w.x, y: w.y });
      const br = mm.viewport.worldToScreen({ x: w.x + w.width, y: w.y + w.height });
      expect(parseFloat(indicator!.style.left)).toBeCloseTo(tl.x, 1);
      expect(parseFloat(indicator!.style.top)).toBeCloseTo(tl.y, 1);
      expect(parseFloat(indicator!.style.width)).toBeCloseTo(br.x - tl.x, 1);
      expect(parseFloat(indicator!.style.height)).toBeCloseTo(br.y - tl.y, 1);
    };

    assertMatchesHost();
    host.viewport.setViewport({ x: -300, y: -200, zoom: 2 });
    assertMatchesHost();

    mm.destroy();
  });

  it('re-fits when the graph changes, via the watch subscription', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });
    const zoomBefore = mm.viewport.viewport.zoom;

    editor.execute(
      commands.nodeAdd({
        id: 'far',
        position: { x: 5000, y: 5000 },
        size: { width: 100, height: 60 },
      }),
    );

    expect(mm.viewport.viewport.zoom).toBeLessThan(zoomBefore);
    const b = host.scene.bounds()!;
    const br = mm.viewport.worldToScreen({ x: b.x + b.width, y: b.y + b.height });
    expect(br.x).toBeLessThanOrEqual(200);
    expect(br.y).toBeLessThanOrEqual(150);

    mm.destroy();
  });

  it('a pointer press on the minimap re-centres the main viewport there', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });
    const root = mount.querySelector<HTMLElement>('[data-graphloom="minimap"]')!;
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 150 }) as DOMRect;

    const local = { x: 60, y: 40 };
    const worldTarget = mm.viewport.screenToWorld(local);
    root.dispatchEvent(pointerEvent('pointerdown', { clientX: local.x, clientY: local.y }));

    const { width, height } = host.viewport.size;
    const hostCentre = host.viewport.screenToWorld({ x: width / 2, y: height / 2 });
    expect(hostCentre.x).toBeCloseTo(worldTarget.x, 0);
    expect(hostCentre.y).toBeCloseTo(worldTarget.y, 0);
    // Zoom is untouched — navigation only pans.
    expect(host.viewport.viewport.zoom).toBe(1);

    mm.destroy();
  });

  it('follows a drag and stops on pointer up', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });
    const root = mount.querySelector<HTMLElement>('[data-graphloom="minimap"]')!;
    root.getBoundingClientRect = () =>
      ({ left: 0, top: 0, width: 200, height: 150 }) as DOMRect;

    const centreOn = (local: { x: number; y: number }) => {
      const t = mm.viewport.screenToWorld(local);
      const s = host.viewport.size;
      const c = host.viewport.screenToWorld({ x: s.width / 2, y: s.height / 2 });
      expect(c.x).toBeCloseTo(t.x, 0);
      expect(c.y).toBeCloseTo(t.y, 0);
    };

    root.dispatchEvent(pointerEvent('pointerdown', { clientX: 40, clientY: 30 }));
    root.dispatchEvent(pointerEvent('pointermove', { clientX: 150, clientY: 110 }));
    centreOn({ x: 150, y: 110 });

    root.dispatchEvent(pointerEvent('pointerup', { clientX: 150, clientY: 110 }));
    const parked = host.viewport.viewport;
    // A move after release does nothing.
    root.dispatchEvent(pointerEvent('pointermove', { clientX: 10, clientY: 10 }));
    expect(host.viewport.viewport).toBe(parked);

    mm.destroy();
  });

  it('applies the class-name options', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({
      host,
      mount,
      watch: watch(editor),
      options: { className: 'mm', indicatorClassName: 'mm-ind' },
    });
    const root = mount.querySelector<HTMLElement>('.mm')!;
    expect(root).not.toBeNull();
    expect(root.dataset.graphloom).toBe('minimap');
    expect(root.querySelector('.mm-ind')).not.toBeNull();
    mm.destroy();
  });

  it('a larger fit padding zooms further out', () => {
    const { host, editor } = world;
    const m1 = world.mount;
    const m2 = sized(200, 150);
    const tight = createMinimap({ host, mount: m1, watch: watch(editor), options: { padding: 0 } });
    const loose = createMinimap({ host, mount: m2, watch: watch(editor), options: { padding: 60 } });
    expect(loose.viewport.viewport.zoom).toBeLessThan(tight.viewport.viewport.zoom);
    tight.destroy();
    loose.destroy();
    m2.remove();
  });

  it('works without a watch (viewport still tracked, model changes need refresh())', () => {
    const { host, mount } = world;
    const mm = createMinimap({ host, mount });
    const indicator = mount.querySelector<HTMLElement>('[data-graphloom="minimap-indicator"]')!;
    host.viewport.setViewport({ x: -100, y: -50, zoom: 1.5 });
    const w = host.viewport.visibleWorldRect();
    const tl = mm.viewport.worldToScreen({ x: w.x, y: w.y });
    expect(parseFloat(indicator.style.left)).toBeCloseTo(tl.x, 1);
    mm.destroy();
  });

  it('stops reacting after destroy', () => {
    const { host, mount, editor } = world;
    const mm = createMinimap({ host, mount, watch: watch(editor) });
    const zoomAtDestroy = mm.viewport.viewport.zoom;
    mm.destroy();

    editor.execute(
      commands.nodeAdd({
        id: 'far',
        position: { x: 9000, y: 9000 },
        size: { width: 100, height: 60 },
      }),
    );
    host.viewport.setViewport({ x: 50, y: 50, zoom: 3 });

    expect(mm.viewport.viewport.zoom).toBe(zoomAtDestroy);
  });
});
