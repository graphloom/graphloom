// The edge geometry engine (P7-T05): pluggable routers producing polyline or
// cubic-chain routes, plus self-loops and deterministic parallel-edge fanning.
// Pure math — no model access, no DOM. Full obstacle-avoiding routing over
// the whole graph is deliberately out of scope (backlog B-05).
import type { Edge, Point } from '@graphloom/core';
import {
  boundsOfPoints,
  clamp,
  cubicBezierPoint,
  inflateRect,
  polylinePointAt,
  rectsIntersect,
  type Rect,
} from './geometry.js';

/**
 * One routed edge: a polyline (2+ points) or a cubic chain (`3n + 1` points:
 * endpoint, then control/control/endpoint triples — a single Bézier is the
 * `n = 1` case).
 */
export interface EdgeRoute {
  readonly curve: 'polyline' | 'cubic';
  readonly points: readonly Point[];
}

/** Sibling info for parallel multi-edge fanning (deterministic by edge id). */
export interface EdgeSiblings {
  /** This edge's slot among the parallel edges (0-based, id-sorted). */
  readonly index: number;
  /** How many edges connect the same node pair (either direction). */
  readonly count: number;
}

/** Everything a router sees about one edge. */
export interface EdgeRouteContext {
  /** Resolved world anchor at the source. */
  readonly from: Point;
  /** Resolved world anchor at the target. */
  readonly to: Point;
  /** World AABB of the source node (rotation applied). */
  readonly sourceBounds: Rect;
  /** World AABB of the target node (rotation applied). */
  readonly targetBounds: Rect;
  readonly siblings: EdgeSiblings;
}

/** A pluggable edge router (P7-T05: the engine is an interface). */
export type EdgeRouter = (edge: Edge, ctx: EdgeRouteContext) => EdgeRoute;

/** Options for the built-in router set. */
export interface RouterOptions {
  /**
   * Orthogonal only: keep the elbow segment out of the source/target bodies
   * (obstacle-aware lite). Off by default this phase so pre-P7 routes stay
   * byte-identical; the demo flips it on at close-out with a re-baseline.
   */
  readonly avoidBodies?: boolean;
  /** Perpendicular fan spacing between parallel edges (world units, default 24). */
  readonly fanGap?: number;
}

/** Signed fan offset for a sibling slot: 0-centered, `gap` apart. */
function fanOffset(siblings: EdgeSiblings, gap: number): number {
  return (siblings.index - (siblings.count - 1) / 2) * gap;
}

/** Unit perpendicular of the from→to direction (zero vector for from == to). */
function perpendicular(from: Point, to: Point): Point {
  const dx = to.x - from.x;
  const dy = to.y - from.y;
  const length = Math.hypot(dx, dy);
  if (length === 0) return { x: 0, y: 0 };
  return { x: -dy / length, y: dx / length };
}

/** Drops interior points that are collinear with their neighbors. */
export function collapseCollinear(points: readonly Point[]): Point[] {
  const out: Point[] = [];
  for (const p of points) {
    const a = out[out.length - 2];
    const b = out[out.length - 1];
    if (a && b && (a.x - b.x) * (b.y - p.y) === (a.y - b.y) * (b.x - p.x)) {
      out[out.length - 1] = p;
    } else {
      out.push(p);
    }
  }
  return out;
}

const straightRouter: EdgeRouter = (_edge, ctx) => {
  if (ctx.siblings.count <= 1) return { curve: 'polyline', points: [ctx.from, ctx.to] };
  // Parallel straight edges bow apart so every sibling stays visible.
  const bow = fanOffset(ctx.siblings, 24);
  const p = perpendicular(ctx.from, ctx.to);
  const c1 = {
    x: ctx.from.x + (ctx.to.x - ctx.from.x) / 3 + p.x * bow,
    y: ctx.from.y + (ctx.to.y - ctx.from.y) / 3 + p.y * bow,
  };
  const c2 = {
    x: ctx.from.x + ((ctx.to.x - ctx.from.x) * 2) / 3 + p.x * bow,
    y: ctx.from.y + ((ctx.to.y - ctx.from.y) * 2) / 3 + p.y * bow,
  };
  return { curve: 'cubic', points: [ctx.from, c1, c2, ctx.to] };
};

const bezierRouter: EdgeRouter = (_edge, ctx) => {
  // The pre-P7 control scheme, byte-identical for the un-fanned case.
  const midX = (ctx.from.x + ctx.to.x) / 2;
  const bow = fanOffset(ctx.siblings, 24);
  const p = perpendicular(ctx.from, ctx.to);
  return {
    curve: 'cubic',
    points: [
      ctx.from,
      { x: midX + p.x * bow, y: ctx.from.y + p.y * bow },
      { x: midX + p.x * bow, y: ctx.to.y + p.y * bow },
      ctx.to,
    ],
  };
};

const smoothRouter: EdgeRouter = (_edge, ctx) => {
  // Tangents follow the dominant axis for a gentle S-curve.
  const dx = ctx.to.x - ctx.from.x;
  const dy = ctx.to.y - ctx.from.y;
  const bow = fanOffset(ctx.siblings, 24);
  const p = perpendicular(ctx.from, ctx.to);
  const horizontal = Math.abs(dx) >= Math.abs(dy);
  const c1 = horizontal
    ? { x: ctx.from.x + dx * 0.5, y: ctx.from.y }
    : { x: ctx.from.x, y: ctx.from.y + dy * 0.5 };
  const c2 = horizontal
    ? { x: ctx.to.x - dx * 0.5, y: ctx.to.y }
    : { x: ctx.to.x, y: ctx.to.y - dy * 0.5 };
  return {
    curve: 'cubic',
    points: [
      ctx.from,
      { x: c1.x + p.x * bow, y: c1.y + p.y * bow },
      { x: c2.x + p.x * bow, y: c2.y + p.y * bow },
      ctx.to,
    ],
  };
};

function orthogonalRouter(options: RouterOptions): EdgeRouter {
  return (_edge, ctx) => {
    const { from, to } = ctx;
    const fan = fanOffset(ctx.siblings, options.fanGap ?? 24);
    let midX = (from.x + to.x) / 2 + fan;
    if (options.avoidBodies === true) {
      // Obstacle-aware lite: keep the vertical elbow segment out of the
      // source/target bodies by pushing it past the nearer free edge.
      // ponytail: only the elbow is checked; routing around arbitrary
      // obstacles is B-05.
      const margin = 12;
      const source = inflateRect(ctx.sourceBounds, margin);
      const target = inflateRect(ctx.targetBounds, margin);
      const elbow = (x: number): Rect => ({
        x,
        y: Math.min(from.y, to.y),
        width: 0,
        height: Math.abs(to.y - from.y),
      });
      for (const body of [source, target]) {
        if (rectsIntersect(elbow(midX), body)) {
          const left = body.x;
          const right = body.x + body.width;
          midX = Math.abs(midX - left) <= Math.abs(midX - right) ? left : right;
        }
      }
    }
    const points = collapseCollinear([
      from,
      { x: midX, y: from.y },
      { x: midX, y: to.y },
      to,
    ]);
    return { curve: 'polyline', points };
  };
}

/** Routes a self-loop: a teardrop cubic bulging away from the node body. */
export const selfLoopRouter: EdgeRouter = (_edge, ctx) => {
  const bounds = ctx.sourceBounds;
  const center = { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 };
  let dirX = ctx.from.x - center.x;
  let dirY = ctx.from.y - center.y;
  const length = Math.hypot(dirX, dirY);
  if (length === 0) {
    dirX = 1;
    dirY = 0;
  } else {
    dirX /= length;
    dirY /= length;
  }
  // 1.25× the larger node extent guarantees the loop's belly clears the
  // body even when the anchor sits at the node center.
  const reach = Math.max(bounds.width, bounds.height) * 1.25 + ctx.siblings.index * 20;
  // Two control points spread ±45° around the outward direction.
  const spread = (45 * Math.PI) / 180;
  const rotateDir = (angle: number): Point => ({
    x: dirX * Math.cos(angle) - dirY * Math.sin(angle),
    y: dirX * Math.sin(angle) + dirY * Math.cos(angle),
  });
  const a = rotateDir(-spread);
  const b = rotateDir(spread);
  return {
    curve: 'cubic',
    points: [
      ctx.from,
      { x: ctx.from.x + a.x * reach, y: ctx.from.y + a.y * reach },
      { x: ctx.to.x + b.x * reach, y: ctx.to.y + b.y * reach },
      ctx.to,
    ],
  };
};

/**
 * The built-in router set, keyed by `Edge.routing`. Hosts/plugins may merge
 * their own routers over it (scene option `routers`).
 */
export function createRouters(options: RouterOptions = {}): ReadonlyMap<string, EdgeRouter> {
  return new Map<string, EdgeRouter>([
    ['straight', straightRouter],
    ['bezier', bezierRouter],
    ['smooth', smoothRouter],
    ['orthogonal', orthogonalRouter(options)],
  ]);
}

/**
 * Routes one edge: self-loops take the loop router regardless of `routing`;
 * unknown routing kinds fall back to straight.
 */
export function routeEdge(
  edge: Edge,
  ctx: EdgeRouteContext,
  routers: ReadonlyMap<string, EdgeRouter>,
): EdgeRoute {
  if (edge.source === edge.target) return selfLoopRouter(edge, ctx);
  const router = routers.get(edge.routing) ?? routers.get('straight');
  return router ? router(edge, ctx) : { curve: 'polyline', points: [ctx.from, ctx.to] };
}

/** Number of cubic segments in a cubic-chain route. */
function chainLength(route: EdgeRoute): number {
  return (route.points.length - 1) / 3;
}

/**
 * Point at normalized position `t` ∈ [0, 1] along a route (edge labels).
 * Cubic chains map `t` uniformly across segments — exact Bézier evaluation,
 * matching the pre-P7 single-curve behavior for `n = 1`.
 */
export function routePointAt(route: EdgeRoute, t: number): Point {
  if (route.curve === 'polyline') return polylinePointAt(route.points, t);
  const n = chainLength(route);
  const scaled = clamp(t, 0, 1) * n;
  const segment = Math.min(Math.floor(scaled), n - 1);
  const local = scaled - segment;
  const base = segment * 3;
  return cubicBezierPoint(
    route.points[base] as Point,
    route.points[base + 1] as Point,
    route.points[base + 2] as Point,
    route.points[base + 3] as Point,
    local,
  );
}

/**
 * Tangent direction (radians) of a route at an endpoint, pointing *along the
 * travel direction* — i.e. into the target at `end`, out of the source at
 * `start`. Markers rotate by this angle (P7-T06 orientation on all curves).
 */
export function routeTangentAt(route: EdgeRoute, at: 'start' | 'end'): number {
  const points = route.points;
  let from: Point;
  let to: Point;
  if (route.curve === 'polyline') {
    from = (at === 'start' ? points[0] : points[points.length - 2]) as Point;
    to = (at === 'start' ? points[1] : points[points.length - 1]) as Point;
  } else if (at === 'start') {
    from = points[0] as Point;
    // Cubic derivative at t=0 points at the first control; degenerate
    // controls fall back to the segment endpoint.
    to = pickDifferent(points, 0, 1);
  } else {
    to = points[points.length - 1] as Point;
    from = pickDifferent(points, points.length - 1, -1);
  }
  return Math.atan2(to.y - from.y, to.x - from.x);
}

/** First point differing from `points[index]`, scanning by `step`. */
function pickDifferent(points: readonly Point[], index: number, step: 1 | -1): Point {
  const origin = points[index] as Point;
  for (let i = index + step; i >= 0 && i < points.length; i += step) {
    const candidate = points[i] as Point;
    if (candidate.x !== origin.x || candidate.y !== origin.y) return candidate;
  }
  return origin;
}

/** Conservative world bounds of a route (control polygon contains the curve). */
export function routeBounds(route: EdgeRoute): Rect {
  return boundsOfPoints(route.points);
}
