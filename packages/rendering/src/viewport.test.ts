import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { ViewportController } from './viewport.js';

const makeVp = (): ViewportController =>
  new ViewportController({ size: { width: 800, height: 600 } });

describe('ViewportController', () => {
  it('starts at identity and clamps construction zoom', () => {
    expect(makeVp().viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    const clamped = new ViewportController({ viewport: { x: 0, y: 0, zoom: 100 } });
    expect(clamped.viewport.zoom).toBe(8);
    expect(() => new ViewportController({ minZoom: 0 })).toThrow(/zoom range/);
    expect(() => new ViewportController({ minZoom: 2, maxZoom: 1 })).toThrow(/zoom range/);
  });

  it('world↔screen round-trip (property)', () => {
    const num = fc.integer({ min: -1_000_000, max: 1_000_000 }).map((v) => v / 100);
    fc.assert(
      fc.property(
        num,
        num,
        fc.integer({ min: 1, max: 80 }).map((v) => v / 10),
        num,
        num,
        (x, y, zoom, px, py) => {
          const vp = makeVp();
          vp.setViewport({ x, y, zoom });
          const back = vp.screenToWorld(vp.worldToScreen({ x: px, y: py }));
          expect(Math.abs(back.x - px)).toBeLessThanOrEqual(1e-6);
          expect(Math.abs(back.y - py)).toBeLessThanOrEqual(1e-6);
        },
      ),
    );
  });

  it('zoom-about-cursor keeps the cursor world point fixed (exact math)', () => {
    const vp = makeVp();
    vp.setViewport({ x: 100, y: 50, zoom: 2 });
    const cursor = { x: 400, y: 300 };
    const worldBefore = vp.screenToWorld(cursor);
    vp.zoomTo(4, cursor);
    expect(vp.worldToScreen(worldBefore)).toEqual(cursor);
    vp.zoomBy(0.25, cursor);
    const after = vp.worldToScreen(worldBefore);
    expect(after.x).toBeCloseTo(cursor.x, 9);
    expect(after.y).toBeCloseTo(cursor.y, 9);
  });

  it('zoomTo clamps to [minZoom, maxZoom]', () => {
    const vp = makeVp();
    vp.zoomTo(1000);
    expect(vp.viewport.zoom).toBe(8);
    vp.zoomTo(0.0001);
    expect(vp.viewport.zoom).toBe(0.1);
  });

  it('panBy moves in screen space', () => {
    const vp = makeVp();
    vp.setViewport({ x: 10, y: 20, zoom: 2 });
    vp.panBy(-5, 15);
    expect(vp.viewport).toEqual({ x: 5, y: 35, zoom: 2 });
  });

  it('zoomToFit centers bounds with padding', () => {
    const vp = makeVp();
    // 800×600 host, 20px padding → avail 760×560; bounds 380×140 → zoom min(2, 4) = 2.
    vp.zoomToFit({ x: 100, y: 100, width: 380, height: 140 });
    expect(vp.viewport.zoom).toBe(2);
    // Bounds center (290, 170) lands on screen center (400, 300).
    expect(vp.worldToScreen({ x: 290, y: 170 })).toEqual({ x: 400, y: 300 });
  });

  it('zoomToFit of an empty graph is a no-op', () => {
    const vp = makeVp();
    vp.setViewport({ x: 7, y: 8, zoom: 3 });
    vp.zoomToFit(null);
    vp.zoomToFit(undefined);
    expect(vp.viewport).toEqual({ x: 7, y: 8, zoom: 3 });
  });

  it('zoomToFit of a single point centers it at the current zoom', () => {
    const vp = makeVp();
    vp.setViewport({ x: 0, y: 0, zoom: 3 });
    vp.zoomToFit({ x: 50, y: 60, width: 0, height: 0 });
    expect(vp.viewport.zoom).toBe(3);
    expect(vp.worldToScreen({ x: 50, y: 60 })).toEqual({ x: 400, y: 300 });
  });

  it('zoomToFit without a host size is a no-op', () => {
    const vp = new ViewportController();
    vp.zoomToFit({ x: 0, y: 0, width: 10, height: 10 });
    expect(vp.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
  });

  it('visibleWorldRect inverts the viewport', () => {
    const vp = makeVp();
    vp.setViewport({ x: -200, y: 100, zoom: 2 });
    expect(vp.visibleWorldRect()).toEqual({ x: 100, y: -50, width: 400, height: 300 });
  });

  it('emits viewport.changed and zoom.changed', () => {
    const vp = makeVp();
    const viewportEvents: unknown[] = [];
    const zoomEvents: unknown[] = [];
    vp.on('viewport.changed', (e) => viewportEvents.push(e.viewport));
    const offZoom = vp.on('zoom.changed', (e) => zoomEvents.push([e.previous, e.zoom]));
    vp.panBy(1, 0); // viewport only
    vp.zoomTo(2); // viewport + zoom
    vp.setViewport(vp.viewport); // no change → no events
    expect(viewportEvents).toHaveLength(2);
    expect(zoomEvents).toEqual([[1, 2]]);
    offZoom();
    vp.zoomTo(4);
    expect(zoomEvents).toHaveLength(1);
  });
});
