import { createEdge, type Edge } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import {
  collapseCollinear,
  createRouters,
  routeEdge,
  routePointAt,
  routeTangentAt,
  selfLoopRouter,
  type EdgeRouteContext,
} from './routing.js';
import { cubicBezierPoint } from './geometry.js';

const edge = (routing: Edge['routing'], id = 'e', source = 'a', target = 'b'): Edge =>
  createEdge({ id, source, target, routing });

const ctx = (overrides: Partial<EdgeRouteContext> = {}): EdgeRouteContext => ({
  from: { x: 50, y: 20 },
  to: { x: 350, y: 220 },
  sourceBounds: { x: 0, y: 0, width: 100, height: 40 },
  targetBounds: { x: 300, y: 200, width: 100, height: 40 },
  siblings: { index: 0, count: 1 },
  ...overrides,
});

const routers = createRouters();

describe('routers per kind (P7-T05)', () => {
  it('straight: a two-point polyline', () => {
    expect(routeEdge(edge('straight'), ctx(), routers)).toEqual({
      curve: 'polyline',
      points: [
        { x: 50, y: 20 },
        { x: 350, y: 220 },
      ],
    });
  });

  it('bezier: the legacy mid-x control scheme (pixel parity)', () => {
    expect(routeEdge(edge('bezier'), ctx(), routers)).toEqual({
      curve: 'cubic',
      points: [
        { x: 50, y: 20 },
        { x: 200, y: 20 },
        { x: 200, y: 220 },
        { x: 350, y: 220 },
      ],
    });
  });

  it('smooth: tangents along the dominant axis', () => {
    const horizontal = routeEdge(edge('smooth'), ctx(), routers);
    expect(horizontal.curve).toBe('cubic');
    expect(horizontal.points[1]).toEqual({ x: 200, y: 20 }); // half dx, level
    const vertical = routeEdge(
      edge('smooth'),
      ctx({ to: { x: 90, y: 420 } }),
      routers,
    );
    expect(vertical.points[1]).toEqual({ x: 50, y: 220 }); // half dy, plumb
  });

  it('orthogonal: mid-x Z-route, collinear points collapsed (no needless bends)', () => {
    const z = routeEdge(edge('orthogonal'), ctx(), routers);
    expect(z).toEqual({
      curve: 'polyline',
      points: [
        { x: 50, y: 20 },
        { x: 200, y: 20 },
        { x: 200, y: 220 },
        { x: 350, y: 220 },
      ],
    });
    // Vertically aligned endpoints: the Z degenerates to one straight segment.
    const aligned = routeEdge(
      edge('orthogonal'),
      ctx({ from: { x: 50, y: 20 }, to: { x: 50, y: 220 } }),
      routers,
    );
    expect(aligned.points).toEqual([
      { x: 50, y: 20 },
      { x: 50, y: 220 },
    ]);
  });

  it('orthogonal with avoidBodies pushes the elbow out of the node bodies', () => {
    const avoiding = createRouters({ avoidBodies: true });
    // Target directly right of the source with overlapping x span for the
    // naive elbow: elbow at mid-x (100) slices the source body (0..100).
    const route = routeEdge(
      edge('orthogonal'),
      ctx({
        from: { x: 50, y: 20 },
        to: { x: 150, y: 220 },
        sourceBounds: { x: 0, y: 0, width: 100, height: 40 },
        targetBounds: { x: 100, y: 200, width: 100, height: 40 },
      }),
      avoiding,
    );
    const elbowX = route.points[1]?.x as number;
    // The naive mid-x is 100 — inside both inflated bodies; it must move out.
    expect(elbowX).not.toBe(100);
    // Still an orthogonal polyline with ≤ 2 bends (no needless bends).
    expect(route.curve).toBe('polyline');
    expect(route.points.length).toBeLessThanOrEqual(4);
    for (let i = 1; i < route.points.length; i++) {
      const a = route.points[i - 1]!;
      const b = route.points[i]!;
      expect(a.x === b.x || a.y === b.y).toBe(true); // axis-aligned segments only
    }
  });

  it('unknown routing kinds fall back to straight', () => {
    const route = routeEdge({ ...edge('straight'), routing: 'zigzag' as Edge['routing'] }, ctx(), routers);
    expect(route.curve).toBe('polyline');
    expect(route.points).toHaveLength(2);
  });
});

describe('parallel multi-edge fanning (P7-T05)', () => {
  it('is deterministic and symmetric around the direct line', () => {
    const siblings = (index: number): EdgeRouteContext => ctx({ siblings: { index, count: 3 } });
    const a = routeEdge(edge('straight', 'e1'), siblings(0), routers);
    const b = routeEdge(edge('straight', 'e2'), siblings(1), routers);
    const c = routeEdge(edge('straight', 'e3'), siblings(2), routers);
    // Middle sibling stays on the direct line; outer two bow to opposite sides.
    expect(b.points[1]).toEqual({ x: 150, y: 86.66666666666667 });
    expect(a.curve).toBe('cubic');
    const mid = routePointAt(a, 0.5);
    const midC = routePointAt(c, 0.5);
    const midB = routePointAt(b, 0.5);
    // a and c are mirrored across b's midpoint.
    expect((mid.x + midC.x) / 2).toBeCloseTo(midB.x, 6);
    expect((mid.y + midC.y) / 2).toBeCloseTo(midB.y, 6);
    // Re-running produces identical geometry (determinism).
    expect(routeEdge(edge('straight', 'e1'), siblings(0), routers)).toEqual(a);
  });
});

describe('self-loops (P7-T05)', () => {
  it('produces a loop that starts and ends at the anchor, bulging outward', () => {
    const loop = selfLoopRouter(edge('straight', 'loop', 'a', 'a'), ctx({ to: { x: 50, y: 20 } }));
    expect(loop.curve).toBe('cubic');
    expect(loop.points[0]).toEqual({ x: 50, y: 20 });
    expect(loop.points[3]).toEqual({ x: 50, y: 20 });
    // The loop's midpoint leaves the node body.
    const mid = routePointAt(loop, 0.5);
    expect(
      mid.x < 0 || mid.x > 100 || mid.y < 0 || mid.y > 40,
    ).toBe(true);
  });

  it('routeEdge picks the loop router for source === target regardless of routing', () => {
    const loop = routeEdge(edge('orthogonal', 'loop', 'a', 'a'), ctx({ to: { x: 50, y: 20 } }), routers);
    expect(loop.points[0]).toEqual(loop.points[3]);
  });

  it('sibling loops widen so parallel self-loops stay distinct', () => {
    const inner = selfLoopRouter(edge('straight', 'l1', 'a', 'a'), ctx({ to: { x: 50, y: 20 }, siblings: { index: 0, count: 2 } }));
    const outer = selfLoopRouter(edge('straight', 'l2', 'a', 'a'), ctx({ to: { x: 50, y: 20 }, siblings: { index: 1, count: 2 } }));
    const din = routePointAt(inner, 0.5);
    const dout = routePointAt(outer, 0.5);
    const dist = (p: { x: number; y: number }): number => Math.hypot(p.x - 50, p.y - 20);
    expect(dist(dout)).toBeGreaterThan(dist(din));
  });
});

describe('route evaluation helpers', () => {
  it('routePointAt matches exact Bézier evaluation on a single cubic (label parity)', () => {
    const route = routeEdge(edge('bezier'), ctx(), routers);
    const exact = cubicBezierPoint(
      { x: 50, y: 20 },
      { x: 200, y: 20 },
      { x: 200, y: 220 },
      { x: 350, y: 220 },
      0.3,
    );
    expect(routePointAt(route, 0.3)).toEqual(exact);
  });

  it('routeTangentAt points along travel direction on every curve type', () => {
    const line = routeEdge(edge('straight'), ctx({ to: { x: 350, y: 20 } }), routers);
    expect(routeTangentAt(line, 'end')).toBeCloseTo(0); // due east
    const curve = routeEdge(edge('bezier'), ctx(), routers);
    // Cubic end tangent: from c2 (200,220) to p1 (350,220) → due east.
    expect(routeTangentAt(curve, 'end')).toBeCloseTo(0);
    // Start tangent of the cubic: p0 (50,20) → c1 (200,20) → due east.
    expect(routeTangentAt(curve, 'start')).toBeCloseTo(0);
    const vertical = routeEdge(edge('orthogonal'), ctx({ from: { x: 50, y: 20 }, to: { x: 50, y: 220 } }), routers);
    expect(routeTangentAt(vertical, 'end')).toBeCloseTo(Math.PI / 2); // due south
  });

  it('collapseCollinear only removes interior collinear points', () => {
    expect(
      collapseCollinear([
        { x: 0, y: 0 },
        { x: 5, y: 0 },
        { x: 10, y: 0 },
        { x: 10, y: 10 },
      ]),
    ).toEqual([
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ]);
  });
});
