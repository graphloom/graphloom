import { describe, expect, it, vi } from 'vitest';
import { GestureRecognizer, type GestureEventMap, type PointerInput } from './gestures.js';

type Fired = { [K in keyof GestureEventMap]?: GestureEventMap[K][] };

/** Recognizer with manual timers and an event log. */
function harness(): {
  g: GestureRecognizer;
  fired: Fired;
  fireTimers: () => void;
  p: (id: number, x: number, y: number, t: number, extra?: Partial<PointerInput>) => PointerInput;
} {
  const timers: (() => void)[] = [];
  const g = new GestureRecognizer({
    schedule: (fn) => {
      timers.push(fn);
      return () => {
        const i = timers.indexOf(fn);
        if (i >= 0) timers.splice(i, 1);
      };
    },
  });
  const fired: Fired = {};
  const types = [
    'tap',
    'double-tap',
    'long-press',
    'drag-start',
    'drag-move',
    'drag-end',
    'drag-cancel',
    'pinch-start',
    'pinch-move',
    'pinch-end',
  ] as const;
  for (const type of types) {
    g.on(type, (payload) => {
      (fired[type] ??= []).push(payload as never);
    });
  }
  return {
    g,
    fired,
    fireTimers: () => {
      for (const fn of timers.splice(0)) fn();
    },
    p: (pointerId, x, y, timestamp, extra = {}) => ({
      pointerId,
      point: { x, y },
      timestamp,
      ...extra,
    }),
  };
}

describe('GestureRecognizer', () => {
  it('down+up within slop is a tap, not a drag', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 10, 10, 0));
    g.move(p(1, 12, 11, 10)); // within 4px slop
    g.up(p(1, 12, 11, 20));
    expect(fired.tap).toHaveLength(1);
    expect(fired['drag-start']).toBeUndefined();
  });

  it('movement beyond slop becomes a drag with origin and deltas', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 10, 10, 0));
    g.move(p(1, 20, 10, 10));
    g.move(p(1, 25, 15, 20));
    g.up(p(1, 25, 15, 30));
    expect(fired['drag-start']?.[0]?.origin).toEqual({ x: 10, y: 10 });
    expect(fired['drag-move']?.at(-1)?.delta).toEqual({ x: 5, y: 5 });
    expect(fired['drag-end']).toHaveLength(1);
    expect(fired.tap).toBeUndefined();
  });

  it('two taps in time and space make a double-tap', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 10, 10, 0));
    g.up(p(1, 10, 10, 20));
    g.down(p(1, 12, 10, 100));
    g.up(p(1, 12, 10, 120));
    expect(fired.tap).toHaveLength(2);
    expect(fired['double-tap']).toHaveLength(1);
    // A third quick tap must not chain a second double-tap.
    g.down(p(1, 12, 10, 200));
    g.up(p(1, 12, 10, 220));
    expect(fired['double-tap']).toHaveLength(1);
  });

  it('slow second tap is not a double-tap', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 10, 10, 0));
    g.up(p(1, 10, 10, 20));
    g.down(p(1, 10, 10, 1000));
    g.up(p(1, 10, 10, 1020));
    expect(fired['double-tap']).toBeUndefined();
  });

  it('stationary hold fires long-press and eats the tap', () => {
    const { g, fired, fireTimers, p } = harness();
    g.down(p(1, 10, 10, 0, { pointerType: 'touch' }));
    fireTimers();
    g.up(p(1, 10, 10, 600));
    expect(fired['long-press']).toHaveLength(1);
    expect(fired.tap).toBeUndefined();
  });

  it('drag cancels the pending long-press', () => {
    const { g, fired, fireTimers, p } = harness();
    g.down(p(1, 10, 10, 0));
    g.move(p(1, 30, 10, 10));
    fireTimers();
    expect(fired['long-press']).toBeUndefined();
    expect(fired['drag-start']).toHaveLength(1);
  });

  it('pointercancel mid-drag aborts cleanly', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 10, 10, 0));
    g.move(p(1, 30, 10, 10));
    g.cancel(p(1, 30, 10, 20));
    expect(fired['drag-cancel']).toHaveLength(1);
    expect(fired['drag-end']).toBeUndefined();
    expect(g.dragging).toBe(false);
  });

  it('second finger mid-drag aborts the drag and starts a pinch', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 10, 10, 0, { pointerType: 'touch' }));
    g.move(p(1, 40, 10, 10));
    expect(fired['drag-start']).toHaveLength(1);
    g.down(p(2, 100, 10, 20, { pointerType: 'touch' }));
    expect(fired['drag-cancel']).toHaveLength(1);
    expect(fired['pinch-start']).toHaveLength(1);
  });

  it('pinch reports relative scale and centroid movement', () => {
    const { g, fired, p } = harness();
    g.down(p(1, 100, 100, 0, { pointerType: 'touch' }));
    g.down(p(2, 200, 100, 10, { pointerType: 'touch' }));
    g.move(p(2, 300, 100, 20)); // distance 100 → 200
    const pinch = fired['pinch-move']?.[0];
    expect(pinch?.scale).toBeCloseTo(2);
    expect(pinch?.center).toEqual({ x: 200, y: 100 });
    expect(pinch?.delta).toEqual({ x: 50, y: 0 });
    g.up(p(2, 300, 100, 30));
    expect(fired['pinch-end']).toHaveLength(1);
    // The remaining finger must not turn into a tap or drag.
    g.up(p(1, 100, 100, 40));
    expect(fired.tap).toBeUndefined();
  });

  it('unknown pointer ids are ignored', () => {
    const { g, fired, p } = harness();
    g.move(p(9, 10, 10, 0));
    g.up(p(9, 10, 10, 10));
    g.cancel(p(9, 10, 10, 20));
    expect(Object.keys(fired)).toHaveLength(0);
  });

  it('default scheduler uses real timers', async () => {
    vi.useFakeTimers();
    const g = new GestureRecognizer({ longPressMs: 50 });
    const seen: unknown[] = [];
    g.on('long-press', (e) => seen.push(e));
    g.down({ pointerId: 1, point: { x: 0, y: 0 }, timestamp: 0, pointerType: 'touch' });
    vi.advanceTimersByTime(60);
    expect(seen).toHaveLength(1);
    vi.useRealTimers();
  });
});

describe('GestureRecognizer.dragging', () => {
  it('reflects an active drag', () => {
    const { g, p } = harness();
    expect(g.dragging).toBe(false);
    g.down(p(1, 0, 0, 0));
    g.move(p(1, 20, 0, 10));
    expect(g.dragging).toBe(true);
    g.up(p(1, 20, 0, 20));
    expect(g.dragging).toBe(false);
  });
});
