import { ViewportController } from '@graphloom/rendering';
import { describe, expect, it } from 'vitest';
import { NO_MODIFIERS } from './gestures.js';
import { PanZoomController } from './panzoom.js';

const setup = (): { vp: ViewportController; pz: PanZoomController } => {
  const vp = new ViewportController({ size: { width: 800, height: 600 } });
  return { vp, pz: new PanZoomController(vp) };
};

describe('PanZoomController', () => {
  it('wheel zooms about the cursor (world point under cursor stays fixed)', () => {
    const { vp, pz } = setup();
    const cursor = { x: 200, y: 150 };
    const worldBefore = vp.screenToWorld(cursor);
    pz.wheel({ point: cursor, deltaY: -100 });
    expect(vp.viewport.zoom).toBeCloseTo(2 ** 0.2);
    const worldAfter = vp.screenToWorld(cursor);
    expect(worldAfter.x).toBeCloseTo(worldBefore.x);
    expect(worldAfter.y).toBeCloseTo(worldBefore.y);
  });

  it('ctrl+wheel (trackpad pinch) is 10× more sensitive', () => {
    const { vp, pz } = setup();
    pz.wheel({ point: { x: 0, y: 0 }, deltaY: -10, modifiers: { ...NO_MODIFIERS, ctrl: true } });
    expect(vp.viewport.zoom).toBeCloseTo(2 ** 0.2);
  });

  it('zoom limits hold under wheel spam', () => {
    const { vp, pz } = setup();
    for (let i = 0; i < 100; i++) pz.wheel({ point: { x: 0, y: 0 }, deltaY: -500 });
    expect(vp.viewport.zoom).toBe(8);
    for (let i = 0; i < 100; i++) pz.wheel({ point: { x: 0, y: 0 }, deltaY: 500 });
    expect(vp.viewport.zoom).toBe(0.1);
  });

  it('pinch scales about the centroid and follows centroid movement', () => {
    const { vp, pz } = setup();
    const center = { x: 400, y: 300 };
    const world = vp.screenToWorld(center);
    pz.pinch({ center, delta: { x: 0, y: 0 }, scale: 2 });
    expect(vp.viewport.zoom).toBe(2);
    const after = vp.screenToWorld(center);
    expect(after.x).toBeCloseTo(world.x);
    expect(after.y).toBeCloseTo(world.y);
    pz.pinch({ center: { x: 410, y: 300 }, delta: { x: 10, y: 0 }, scale: 1 });
    expect(vp.viewport.x).toBeCloseTo(-390); // panned +10 from -400
  });

  it('panBy pans the viewport', () => {
    const { vp, pz } = setup();
    pz.panBy(15, -5);
    expect(vp.viewport).toEqual({ x: 15, y: -5, zoom: 1 });
  });
});
