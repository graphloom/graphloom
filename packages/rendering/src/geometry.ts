import type { Point } from '@graphloom/core';

/** An axis-aligned rectangle in world or screen coordinates. */
export interface Rect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/**
 * A 2×3 affine transform in canvas/SVG order: `x' = a·x + c·y + e`,
 * `y' = b·x + d·y + f` (same element names as `DOMMatrix`).
 */
export interface Mat2x3 {
  readonly a: number;
  readonly b: number;
  readonly c: number;
  readonly d: number;
  readonly e: number;
  readonly f: number;
}

/** The identity transform. */
export const IDENTITY: Mat2x3 = { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };

/** Clamps `value` into `[min, max]`. */
export function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

/** True when `x` and `y` differ by at most `epsilon` (default 1e-9). */
export function almostEqual(x: number, y: number, epsilon = 1e-9): boolean {
  return Math.abs(x - y) <= epsilon;
}

/** Composes two transforms: the result applies `second` first, then `first`. */
export function compose(first: Mat2x3, second: Mat2x3): Mat2x3 {
  return {
    a: first.a * second.a + first.c * second.b,
    b: first.b * second.a + first.d * second.b,
    c: first.a * second.c + first.c * second.d,
    d: first.b * second.c + first.d * second.d,
    e: first.a * second.e + first.c * second.f + first.e,
    f: first.b * second.e + first.d * second.f + first.f,
  };
}

/** A translation transform. */
export function translation(tx: number, ty: number): Mat2x3 {
  return { a: 1, b: 0, c: 0, d: 1, e: tx, f: ty };
}

/** A scale transform (uniform when `sy` is omitted). */
export function scaling(sx: number, sy = sx): Mat2x3 {
  return { a: sx, b: 0, c: 0, d: sy, e: 0, f: 0 };
}

/** A clockwise rotation (degrees) about the origin. */
export function rotation(degrees: number): Mat2x3 {
  const r = (degrees * Math.PI) / 180;
  const cos = Math.cos(r);
  const sin = Math.sin(r);
  return { a: cos, b: sin, c: -sin, d: cos, e: 0, f: 0 };
}

/** A clockwise rotation (degrees) about the point `(cx, cy)`. */
export function rotationAbout(degrees: number, cx: number, cy: number): Mat2x3 {
  return compose(translation(cx, cy), compose(rotation(degrees), translation(-cx, -cy)));
}

/** Inverts an affine transform. Throws on a singular (non-invertible) matrix. */
export function invert(m: Mat2x3): Mat2x3 {
  const det = m.a * m.d - m.b * m.c;
  if (!Number.isFinite(det) || Math.abs(det) < 1e-12) {
    throw new Error('cannot invert singular transform');
  }
  const a = m.d / det;
  const b = -m.b / det;
  const c = -m.c / det;
  const d = m.a / det;
  return {
    a,
    b,
    c,
    d,
    e: -(a * m.e + c * m.f),
    f: -(b * m.e + d * m.f),
  };
}

/** Applies a transform to a point. */
export function applyToPoint(m: Mat2x3, p: Point): Point {
  return { x: m.a * p.x + m.c * p.y + m.e, y: m.b * p.x + m.d * p.y + m.f };
}

/** True when the point lies inside the rect (edges inclusive). */
export function rectContainsPoint(r: Rect, p: Point): boolean {
  return p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;
}

/** True when the two rects overlap (touching edges count). */
export function rectsIntersect(a: Rect, b: Rect): boolean {
  return (
    a.x <= b.x + b.width && b.x <= a.x + a.width && a.y <= b.y + b.height && b.y <= a.y + a.height
  );
}

/** True when `outer` fully contains `inner` (edges inclusive). */
export function rectContainsRect(outer: Rect, inner: Rect): boolean {
  return (
    inner.x >= outer.x &&
    inner.y >= outer.y &&
    inner.x + inner.width <= outer.x + outer.width &&
    inner.y + inner.height <= outer.y + outer.height
  );
}

/** The smallest rect containing both inputs. */
export function unionRects(a: Rect, b: Rect): Rect {
  const x = Math.min(a.x, b.x);
  const y = Math.min(a.y, b.y);
  return {
    x,
    y,
    width: Math.max(a.x + a.width, b.x + b.width) - x,
    height: Math.max(a.y + a.height, b.y + b.height) - y,
  };
}

/** Grows (or shrinks, negative `margin`) a rect on every side. */
export function inflateRect(r: Rect, margin: number): Rect {
  return {
    x: r.x - margin,
    y: r.y - margin,
    width: r.width + 2 * margin,
    height: r.height + 2 * margin,
  };
}

/** The center point of a rect. */
export function rectCenter(r: Rect): Point {
  return { x: r.x + r.width / 2, y: r.y + r.height / 2 };
}

/** The smallest rect containing every point. Throws on an empty list. */
export function boundsOfPoints(points: readonly Point[]): Rect {
  if (points.length === 0) throw new Error('boundsOfPoints: empty point list');
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const p of points) {
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

/**
 * The four corners of a rect after rotating it `degrees` clockwise about its
 * center (node rotation semantics), in top-left/top-right/bottom-right/
 * bottom-left order.
 */
export function rotatedRectCorners(r: Rect, degrees: number): readonly [Point, Point, Point, Point] {
  const m = rotationAbout(degrees, r.x + r.width / 2, r.y + r.height / 2);
  return [
    applyToPoint(m, { x: r.x, y: r.y }),
    applyToPoint(m, { x: r.x + r.width, y: r.y }),
    applyToPoint(m, { x: r.x + r.width, y: r.y + r.height }),
    applyToPoint(m, { x: r.x, y: r.y + r.height }),
  ];
}

/** Axis-aligned bounds of a rect rotated `degrees` clockwise about its center. */
export function rotatedRectBounds(r: Rect, degrees: number): Rect {
  if (degrees % 360 === 0) return r;
  return boundsOfPoints(rotatedRectCorners(r, degrees));
}

/** True when the point lies inside the rect rotated about its center. */
export function pointInRotatedRect(p: Point, r: Rect, degrees: number): boolean {
  if (degrees % 360 === 0) return rectContainsPoint(r, p);
  // Un-rotate the point into the rect's local space instead of rotating the rect.
  const local = applyToPoint(rotationAbout(-degrees, r.x + r.width / 2, r.y + r.height / 2), p);
  return rectContainsPoint(r, local);
}

/** True when the point lies inside the ellipse inscribed in the (rotated) rect. */
export function pointInEllipse(p: Point, r: Rect, degrees = 0): boolean {
  if (r.width === 0 || r.height === 0) return false;
  const center = rectCenter(r);
  const local = degrees % 360 === 0 ? p : applyToPoint(rotationAbout(-degrees, center.x, center.y), p);
  const dx = (local.x - center.x) / (r.width / 2);
  const dy = (local.y - center.y) / (r.height / 2);
  return dx * dx + dy * dy <= 1;
}

/** True when the point lies inside the polygon (even-odd rule; edges count). */
export function pointInPolygon(p: Point, points: readonly Point[]): boolean {
  if (points.length < 3) return false;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const a = points[i] as Point;
    const b = points[j] as Point;
    if ((a.y > p.y) !== (b.y > p.y)) {
      const x = ((b.x - a.x) * (p.y - a.y)) / (b.y - a.y) + a.x;
      if (p.x < x) inside = !inside;
    }
  }
  return inside || distanceToPolyline(p, [...points, points[0] as Point]) === 0;
}

/** Point on a quadratic Bézier (endpoints `p0`/`p1`, control `c`) at `t` ∈ [0, 1]. */
export function quadraticBezierPoint(p0: Point, c: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  return {
    x: u * u * p0.x + 2 * u * t * c.x + t * t * p1.x,
    y: u * u * p0.y + 2 * u * t * c.y + t * t * p1.y,
  };
}

/** Shortest distance from a point to the segment `[a, b]`. */
export function distanceToSegment(p: Point, a: Point, b: Point): number {
  const abx = b.x - a.x;
  const aby = b.y - a.y;
  const lengthSq = abx * abx + aby * aby;
  const t =
    lengthSq === 0 ? 0 : clamp(((p.x - a.x) * abx + (p.y - a.y) * aby) / lengthSq, 0, 1);
  const cx = a.x + t * abx;
  const cy = a.y + t * aby;
  return Math.hypot(p.x - cx, p.y - cy);
}

/** Shortest distance from a point to a polyline (2+ points). */
export function distanceToPolyline(p: Point, points: readonly Point[]): number {
  let min = Infinity;
  for (let i = 1; i < points.length; i++) {
    const d = distanceToSegment(p, points[i - 1] as Point, points[i] as Point);
    if (d < min) min = d;
  }
  return min;
}

/** True when segments `[a1, a2]` and `[b1, b2]` intersect (touching counts). */
export function segmentsIntersect(a1: Point, a2: Point, b1: Point, b2: Point): boolean {
  const orient = (p: Point, q: Point, r: Point): number => {
    const v = (q.x - p.x) * (r.y - p.y) - (q.y - p.y) * (r.x - p.x);
    return v > 0 ? 1 : v < 0 ? -1 : 0;
  };
  const onSegment = (p: Point, q: Point, r: Point): boolean =>
    Math.min(p.x, r.x) <= q.x &&
    q.x <= Math.max(p.x, r.x) &&
    Math.min(p.y, r.y) <= q.y &&
    q.y <= Math.max(p.y, r.y);
  const o1 = orient(a1, a2, b1);
  const o2 = orient(a1, a2, b2);
  const o3 = orient(b1, b2, a1);
  const o4 = orient(b1, b2, a2);
  if (o1 !== o2 && o3 !== o4) return true;
  if (o1 === 0 && onSegment(a1, b1, a2)) return true;
  if (o2 === 0 && onSegment(a1, b2, a2)) return true;
  if (o3 === 0 && onSegment(b1, a1, b2)) return true;
  return o4 === 0 && onSegment(b1, a2, b2);
}

/** Point on a cubic Bézier (endpoints `p0`/`p1`, controls `c1`/`c2`) at `t` ∈ [0, 1]. */
export function cubicBezierPoint(p0: Point, c1: Point, c2: Point, p1: Point, t: number): Point {
  const u = 1 - t;
  const w0 = u * u * u;
  const w1 = 3 * u * u * t;
  const w2 = 3 * u * t * t;
  const w3 = t * t * t;
  return {
    x: w0 * p0.x + w1 * c1.x + w2 * c2.x + w3 * p1.x,
    y: w0 * p0.y + w1 * c1.y + w2 * c2.y + w3 * p1.y,
  };
}

/** Flattens a cubic Bézier into `segments + 1` polyline points (culling/hit tests). */
export function flattenCubicBezier(
  p0: Point,
  c1: Point,
  c2: Point,
  p1: Point,
  segments = 16,
): Point[] {
  const points: Point[] = [];
  for (let i = 0; i <= segments; i++) {
    points.push(cubicBezierPoint(p0, c1, c2, p1, i / segments));
  }
  return points;
}

/** Point at normalized arc length `t` ∈ [0, 1] along a polyline (2+ points). */
export function polylinePointAt(points: readonly Point[], t: number): Point {
  const first = points[0];
  if (first === undefined) throw new Error('polylinePointAt: empty polyline');
  let total = 0;
  const lengths: number[] = [];
  for (let i = 1; i < points.length; i++) {
    const len = Math.hypot(
      (points[i] as Point).x - (points[i - 1] as Point).x,
      (points[i] as Point).y - (points[i - 1] as Point).y,
    );
    lengths.push(len);
    total += len;
  }
  if (total === 0) return first;
  let remaining = clamp(t, 0, 1) * total;
  for (let i = 0; i < lengths.length; i++) {
    const len = lengths[i] as number;
    if (remaining <= len && len > 0) {
      const a = points[i] as Point;
      const b = points[i + 1] as Point;
      const s = remaining / len;
      return { x: a.x + (b.x - a.x) * s, y: a.y + (b.y - a.y) * s };
    }
    remaining -= len;
  }
  return points[points.length - 1] as Point;
}

/** True when the segment `[a, b]` intersects the rect (either endpoint inside counts). */
export function segmentIntersectsRect(a: Point, b: Point, r: Rect): boolean {
  if (rectContainsPoint(r, a) || rectContainsPoint(r, b)) return true;
  const tl = { x: r.x, y: r.y };
  const tr = { x: r.x + r.width, y: r.y };
  const br = { x: r.x + r.width, y: r.y + r.height };
  const bl = { x: r.x, y: r.y + r.height };
  return (
    segmentsIntersect(a, b, tl, tr) ||
    segmentsIntersect(a, b, tr, br) ||
    segmentsIntersect(a, b, br, bl) ||
    segmentsIntersect(a, b, bl, tl)
  );
}
