import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import {
  almostEqual,
  applyToPoint,
  boundsOfPoints,
  clamp,
  compose,
  distanceToPolyline,
  distanceToSegment,
  IDENTITY,
  inflateRect,
  invert,
  pointInEllipse,
  pointInRotatedRect,
  rectCenter,
  rectContainsPoint,
  rectContainsRect,
  rectsIntersect,
  rotatedRectBounds,
  rotatedRectCorners,
  rotation,
  rotationAbout,
  scaling,
  segmentIntersectsRect,
  segmentsIntersect,
  translation,
  unionRects,
  type Mat2x3,
  type Rect,
} from './geometry.js';

// Coordinates are quantized to 0.01 world units: raw doubles produce
// denormals (5e-324) whose one-ulp rounding breaks edge-inclusive containment
// asserts — magnitudes no graph document can hold.
const num = fc.integer({ min: -1_000_000, max: 1_000_000 }).map((v) => v / 100);
const size = fc.integer({ min: 0, max: 1_000_000 }).map((v) => v / 100);
const point = fc.record({ x: num, y: num });
const rect = fc.record({ x: num, y: num, width: size, height: size });
// Well-conditioned invertible transform: random translate ∘ rotate ∘ scale.
const matrix = fc
  .record({
    tx: num,
    ty: num,
    deg: fc.double({ min: -360, max: 360, noNaN: true }),
    sx: fc.double({ min: 0.1, max: 10, noNaN: true }),
    sy: fc.double({ min: 0.1, max: 10, noNaN: true }),
  })
  .map(({ tx, ty, deg, sx, sy }) =>
    compose(translation(tx, ty), compose(rotation(deg), scaling(sx, sy))),
  );

const expectClose = (actual: number, expected: number, eps = 1e-6): void => {
  expect(Math.abs(actual - expected)).toBeLessThanOrEqual(eps);
};
const expectMatClose = (m: Mat2x3, n: Mat2x3, eps = 1e-6): void => {
  for (const k of ['a', 'b', 'c', 'd', 'e', 'f'] as const) expectClose(m[k], n[k], eps);
};

describe('transforms', () => {
  it('compose(m, invert(m)) is the identity (property)', () => {
    fc.assert(
      fc.property(matrix, (m) => {
        expectMatClose(compose(m, invert(m)), IDENTITY, 1e-6);
        expectMatClose(compose(invert(m), m), IDENTITY, 1e-6);
      }),
    );
  });

  it('invert round-trips points (property)', () => {
    fc.assert(
      fc.property(matrix, point, (m, p) => {
        const back = applyToPoint(invert(m), applyToPoint(m, p));
        expectClose(back.x, p.x, 1e-5);
        expectClose(back.y, p.y, 1e-5);
      }),
    );
  });

  it('compose is associative (property)', () => {
    fc.assert(
      fc.property(matrix, matrix, matrix, point, (m1, m2, m3, p) => {
        const left = applyToPoint(compose(compose(m1, m2), m3), p);
        const right = applyToPoint(compose(m1, compose(m2, m3)), p);
        expectClose(left.x, right.x, 1e-4);
        expectClose(left.y, right.y, 1e-4);
      }),
    );
  });

  it('compose applies the second transform first', () => {
    // Translate then scale: (1,0) -> (2,0) -> scaled (4,0).
    const m = compose(scaling(2), translation(1, 0));
    expect(applyToPoint(m, { x: 1, y: 0 })).toEqual({ x: 4, y: 0 });
  });

  it('rotation is clockwise in screen coordinates', () => {
    const p = applyToPoint(rotation(90), { x: 1, y: 0 });
    expectClose(p.x, 0);
    expectClose(p.y, 1); // +y is down, so clockwise 90° sends +x to +y
  });

  it('rotationAbout keeps its pivot fixed (property)', () => {
    fc.assert(
      fc.property(num, num, fc.double({ min: -360, max: 360, noNaN: true }), (cx, cy, deg) => {
        const p = applyToPoint(rotationAbout(deg, cx, cy), { x: cx, y: cy });
        expectClose(p.x, cx, 1e-6);
        expectClose(p.y, cy, 1e-6);
      }),
    );
  });

  it('invert throws on a singular matrix', () => {
    expect(() => invert(scaling(0))).toThrow(/singular/);
  });
});

describe('rects', () => {
  it('contains / intersects / union basics', () => {
    const r: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(rectContainsPoint(r, { x: 0, y: 10 })).toBe(true);
    expect(rectContainsPoint(r, { x: -0.1, y: 5 })).toBe(false);
    expect(rectsIntersect(r, { x: 10, y: 10, width: 5, height: 5 })).toBe(true);
    expect(rectsIntersect(r, { x: 11, y: 0, width: 5, height: 5 })).toBe(false);
    expect(rectContainsRect(r, { x: 2, y: 2, width: 8, height: 8 })).toBe(true);
    expect(rectContainsRect(r, { x: 2, y: 2, width: 9, height: 8 })).toBe(false);
    expect(unionRects(r, { x: -5, y: 5, width: 5, height: 10 })).toEqual({
      x: -5,
      y: 0,
      width: 15,
      height: 15,
    });
    expect(inflateRect(r, 2)).toEqual({ x: -2, y: -2, width: 14, height: 14 });
    expect(rectCenter(r)).toEqual({ x: 5, y: 5 });
  });

  it('union contains both inputs (property)', () => {
    fc.assert(
      fc.property(rect, rect, (a, b) => {
        // Containment up to one ulp: x+width round-trips are lossy in floats.
        const u = inflateRect(unionRects(a, b), 1e-6);
        expect(rectContainsRect(u, a)).toBe(true);
        expect(rectContainsRect(u, b)).toBe(true);
      }),
    );
  });

  it('boundsOfPoints contains every input point (property)', () => {
    fc.assert(
      fc.property(fc.array(point, { minLength: 1, maxLength: 50 }), (points) => {
        const b = inflateRect(boundsOfPoints(points), 1e-6);
        for (const p of points) expect(rectContainsPoint(b, p)).toBe(true);
      }),
    );
  });

  it('boundsOfPoints throws on empty input', () => {
    expect(() => boundsOfPoints([])).toThrow(/empty/);
  });
});

describe('rotation-aware bounds and hit tests', () => {
  const degrees = fc.double({ min: -360, max: 360, noNaN: true });

  it('rotated bounds contain all rotated corners (property)', () => {
    fc.assert(
      fc.property(rect, degrees, (r, deg) => {
        const bounds = inflateRect(rotatedRectBounds(r, deg), 1e-6);
        for (const corner of rotatedRectCorners(r, deg)) {
          expect(rectContainsPoint(bounds, corner)).toBe(true);
        }
      }),
    );
  });

  it('rotation by a multiple of 360 is the unrotated rect', () => {
    const r: Rect = { x: 3, y: 4, width: 5, height: 6 };
    expect(rotatedRectBounds(r, 720)).toEqual(r);
  });

  it('the center is inside a rotated rect at any angle (property)', () => {
    fc.assert(
      fc.property(rect, degrees, (r, deg) => {
        fc.pre(r.width > 0 && r.height > 0);
        expect(pointInRotatedRect(rectCenter(r), r, deg)).toBe(true);
        expect(pointInEllipse(rectCenter(r), r, deg)).toBe(true);
      }),
    );
  });

  it('pointInRotatedRect matches plain containment at 0°', () => {
    const r: Rect = { x: 0, y: 0, width: 10, height: 4 };
    expect(pointInRotatedRect({ x: 9, y: 3 }, r, 0)).toBe(true);
    // After 90° about center (5,2), the rect spans x∈[3,7], y∈[-3,7].
    expect(pointInRotatedRect({ x: 9, y: 3 }, r, 90)).toBe(false);
    expect(pointInRotatedRect({ x: 4, y: -2 }, r, 90)).toBe(true);
  });

  it('ellipse containment excludes rect corners', () => {
    const r: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(pointInEllipse({ x: 0.5, y: 0.5 }, r)).toBe(false);
    expect(pointInEllipse({ x: 5, y: 0 }, r)).toBe(true);
    expect(pointInEllipse({ x: 1, y: 1 }, { x: 0, y: 0, width: 0, height: 10 })).toBe(false);
  });
});

describe('segments', () => {
  it('distanceToSegment: perpendicular, endpoint, and degenerate cases', () => {
    expectClose(distanceToSegment({ x: 5, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 3);
    expectClose(distanceToSegment({ x: -4, y: 3 }, { x: 0, y: 0 }, { x: 10, y: 0 }), 5);
    expectClose(distanceToSegment({ x: 3, y: 4 }, { x: 0, y: 0 }, { x: 0, y: 0 }), 5);
  });

  it('distanceToPolyline takes the minimum over segments', () => {
    const line = [
      { x: 0, y: 0 },
      { x: 10, y: 0 },
      { x: 10, y: 10 },
    ];
    expectClose(distanceToPolyline({ x: 12, y: 9 }, line), 2);
  });

  it('segmentsIntersect: crossing, touching, collinear, disjoint', () => {
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 10 }, { x: 0, y: 10 }, { x: 10, y: 0 }),
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 5, y: 5 }, { x: 5, y: 5 }, { x: 10, y: 0 }),
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 2, y: 0 }, { x: 8, y: 0 }),
    ).toBe(true);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 4, y: 0 }, { x: 5, y: 0 }, { x: 8, y: 0 }),
    ).toBe(false);
    expect(
      segmentsIntersect({ x: 0, y: 0 }, { x: 10, y: 0 }, { x: 3, y: 1 }, { x: 6, y: 5 }),
    ).toBe(false);
  });

  it('segmentIntersectsRect: through, inside, outside', () => {
    const r: Rect = { x: 0, y: 0, width: 10, height: 10 };
    expect(segmentIntersectsRect({ x: -5, y: 5 }, { x: 15, y: 5 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: 2, y: 2 }, { x: 3, y: 3 }, r)).toBe(true);
    expect(segmentIntersectsRect({ x: -5, y: -1 }, { x: 15, y: -1 }, r)).toBe(false);
  });
});

describe('scalars', () => {
  it('clamp and almostEqual', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(11, 0, 10)).toBe(10);
    expect(almostEqual(0.1 + 0.2, 0.3)).toBe(true);
    expect(almostEqual(1, 1.1)).toBe(false);
  });
});
