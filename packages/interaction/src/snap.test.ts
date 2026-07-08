import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { SceneGraph, SpatialIndex, ViewportController } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import type { SnapContext } from './drag.js';
import { Snapper, type SnapGuide } from './snap.js';

let editor: GraphEditor;
let spatial: SpatialIndex;
let viewport: ViewportController;

const ctx = (bounds: SnapContext['bounds'], disabled = false): SnapContext => ({
  bounds,
  nodeIds: ['moving'],
  disabled,
});

beforeEach(() => {
  editor = createGraph();
  // A stationary anchor node at x 100..180, y 100..140 (edges 100/140/180 in x).
  editor.execute(
    commands.nodeAdd({
      id: 'anchor',
      position: { x: 100, y: 100 },
      size: { width: 80, height: 40 },
    }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'moving', position: { x: 0, y: 0 }, size: { width: 40, height: 20 } }),
  );
  spatial = new SpatialIndex(new SceneGraph(editor));
  viewport = new ViewportController({ size: { width: 800, height: 600 } });
});

describe('Snapper', () => {
  it('snaps to object edges with a guide line', () => {
    const snapper = new Snapper(spatial, viewport, { gridSize: null });
    const snap = snapper.provider();
    // Moving box left edge at 97 → 3 px from the anchor's left edge (100).
    const out = snap({ x: 97, y: 0 }, ctx({ x: 97, y: 300, width: 40, height: 20 }));
    expect(out.x).toBe(100);
    expect(out.y).toBe(0);
    expect(snapper.guides).toEqual([{ axis: 'x', value: 100 }]);
  });

  it('snaps centers to centers on both axes', () => {
    const snapper = new Snapper(spatial, viewport, { gridSize: null });
    // Anchor center is (140,120); moving box 40×20 centered at (138,118).
    const out = snapper.provider()({ x: 0, y: 0 }, ctx({ x: 118, y: 108, width: 40, height: 20 }));
    expect(out).toEqual({ x: 2, y: 2 });
    expect(snapper.guides).toEqual([
      { axis: 'x', value: 140 },
      { axis: 'y', value: 120 },
    ]);
  });

  it('snaps to the grid without producing guides', () => {
    const snapper = new Snapper(spatial, viewport, { objects: false, gridSize: 20 });
    const out = snapper.provider()({ x: 0, y: 0 }, ctx({ x: 43, y: 292, width: 40, height: 20 }));
    expect(out).toEqual({ x: -3, y: -2 }); // left 43→40; centerY 302→300
    expect(snapper.guides).toEqual([]);
  });

  it('snap radius is screen-space: high zoom shrinks the world radius', () => {
    const snapper = new Snapper(spatial, viewport, { gridSize: null, radius: 8 });
    const snap = snapper.provider();
    const bounds = { x: 94, y: 300, width: 40, height: 20 }; // 6 world px from the 100 edge
    expect(snap({ x: 0, y: 0 }, ctx(bounds)).x).toBe(6); // zoom 1: within 8px radius
    viewport.setViewport({ x: 0, y: 0, zoom: 4 }); // radius becomes 2 world units
    expect(snap({ x: 0, y: 0 }, ctx(bounds)).x).toBe(0);
  });

  it('alt (disabled) passes through and clears guides', () => {
    const snapper = new Snapper(spatial, viewport, { gridSize: null });
    const snap = snapper.provider();
    const bounds = { x: 97, y: 300, width: 40, height: 20 };
    snap({ x: 0, y: 0 }, ctx(bounds));
    expect(snapper.guides).toHaveLength(1);
    const out = snap({ x: 5, y: 7 }, ctx(bounds, true));
    expect(out).toEqual({ x: 5, y: 7 });
    expect(snapper.guides).toEqual([]);
  });

  it('dragged nodes are excluded as snap targets and guide events fire on change', () => {
    const events: (readonly SnapGuide[])[] = [];
    const snapper = new Snapper(spatial, viewport, { gridSize: null });
    snapper.on('guides.changed', ({ guides }) => events.push(guides));
    const snap = snapper.provider();
    // The moving box sits exactly where node "moving" is — if it counted
    // itself as a target everything would always snap with delta 0 + guide.
    snap({ x: 0, y: 0 }, ctx({ x: 0, y: 0, width: 40, height: 20 }));
    expect(snapper.guides).toEqual([]);
    snap({ x: 0, y: 0 }, ctx({ x: 97, y: 300, width: 40, height: 20 }));
    snapper.clear();
    expect(events).toEqual([[{ axis: 'x', value: 100 }], []]);
  });

  it('nothing in range means identity offset', () => {
    const snapper = new Snapper(spatial, viewport, { gridSize: null });
    const out = snapper.provider()({ x: 3, y: 4 }, ctx({ x: 500, y: 500, width: 40, height: 20 }));
    expect(out).toEqual({ x: 3, y: 4 });
  });
});
