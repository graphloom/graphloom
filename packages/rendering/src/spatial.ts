import type { Point } from '@graphloom/core';
import { quadtree, type Quadtree, type QuadtreeLeaf } from 'd3-quadtree';
import {
  applyToPoint,
  distanceToPolyline,
  flattenCubicBezier,
  inflateRect,
  pointInEllipse,
  pointInPolygon,
  pointInRotatedRect,
  rectContainsPoint,
  rectsIntersect,
  rotationAbout,
  type Rect,
} from './geometry.js';
import { flattenSegments } from './spec.js';
import { compareRenderItems, type RenderItem, type SceneGraph } from './scene.js';

/** Options for {@link SpatialIndex} hit queries. */
export interface HitTestOptions {
  /**
   * Pick slop in world units (screen px ÷ zoom — the interaction layer
   * converts). Applied around shapes/text and added to path stroke width.
   */
  readonly tolerance?: number;
  /** Item filter (e.g. skip labels while wiring edges). */
  readonly filter?: (item: RenderItem) => boolean;
}

const polylineOf = (item: RenderItem & { kind: 'path' }): readonly Point[] => {
  if (item.curve !== 'cubic') return item.points;
  const flat: Point[] = [item.points[0] as Point];
  for (let base = 0; base + 3 < item.points.length; base += 3) {
    flat.push(
      ...flattenCubicBezier(
        item.points[base] as Point,
        item.points[base + 1] as Point,
        item.points[base + 2] as Point,
        item.points[base + 3] as Point,
      ).slice(1),
    );
  }
  return flat;
};

/** Un-rotates a point into an item's local space (pivot-aware). */
const unrotated = (point: Point, rect: Rect, rotation: number, pivot?: Point): Point => {
  if (rotation % 360 === 0) return point;
  const origin = pivot ?? { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
  return applyToPoint(rotationAbout(-rotation, origin.x, origin.y), point);
};

/** True when the point is inside or within `slop` of any flattened subpath. */
function hitPathGeometry(
  point: Point,
  subpaths: readonly (readonly Point[])[],
  slop: number,
  filled: boolean,
): boolean {
  for (const ring of subpaths) {
    if (filled && pointInPolygon(point, ring)) return true;
    if (distanceToPolyline(point, ring) <= slop) return true;
  }
  return false;
}

/** Precise, zoom-independent hit test for one render item (world coordinates). */
export function hitTestItem(item: RenderItem, point: Point, tolerance = 0): boolean {
  const slop = tolerance + item.style.strokeWidth / 2;
  switch (item.kind) {
    case 'shape': {
      switch (item.shape) {
        case 'ellipse': {
          const local = unrotated(point, item.rect, item.rotation, item.pivot);
          return pointInEllipse(local, inflateRect(item.rect, slop), 0);
        }
        case 'polygon':
          return (
            pointInPolygon(point, item.points ?? []) ||
            (item.points !== undefined &&
              item.points.length > 1 &&
              distanceToPolyline(point, [...item.points, item.points[0] as Point]) <= slop)
          );
        case 'path':
          return hitPathGeometry(
            point,
            flattenSegments(item.segments ?? []),
            slop,
            item.style.fill !== 'none',
          );
        default: {
          // rect / roundRect — rounded corners hit as square corners.
          // ponytail: corner error ≤ radius·(1−1/√2) ≈ 3px at radius 10;
          // exact rounded-corner math only if picking ever feels wrong.
          const local = unrotated(point, item.rect, item.rotation, item.pivot);
          return rectContainsPoint(inflateRect(item.rect, slop), local);
        }
      }
    }
    case 'path':
      return distanceToPolyline(point, polylineOf(item)) <= slop;
    case 'text':
      return pointInRotatedRect(point, inflateRect(item.bounds, tolerance), 0);
    case 'image':
    case 'icon': {
      const local = unrotated(point, item.rect, item.rotation, item.pivot);
      return rectContainsPoint(inflateRect(item.rect, tolerance), local);
    }
    case 'port':
      return (
        Math.hypot(point.x - item.center.x, point.y - item.center.y) <= item.radius + slop
      );
    case 'marker':
      return rectContainsPoint(inflateRect(item.bounds, tolerance), point);
  }
}

/**
 * Precise hits among `items` (which must be in paint order), top-most first.
 * The one pick routine shared by {@link SpatialIndex} and every renderer's
 * `hitTest`, so picking can never differ between backends (ADR-0002).
 */
export function pickTopmost(
  items: readonly RenderItem[],
  point: Point,
  options: HitTestOptions = {},
): RenderItem[] {
  const tolerance = options.tolerance ?? 0;
  return items
    .filter((item) => (options.filter?.(item) ?? true) && hitTestItem(item, point, tolerance))
    .reverse();
}

/**
 * Quadtree-backed spatial index over scene items (ADR-0002: hit testing lives
 * here, never in DOM event targets, so every renderer picks identically).
 *
 * Stays consistent by rebuilding lazily whenever the scene's revision moved.
 */
export class SpatialIndex {
  // ponytail: full rebuild per changed revision, O(n) at the 500-node default
  // (ADR-0007); switch to incremental quadtree add/remove if profiling says so.
  #scene: SceneGraph;
  #tree: Quadtree<RenderItem> | null = null;
  #revision = -1;
  #maxHalfWidth = 0;
  #maxHalfHeight = 0;
  #maxStroke = 0;

  constructor(scene: SceneGraph) {
    this.#scene = scene;
  }

  /** Items whose bounds intersect `rect`, in paint order (culling, rubber-band). */
  query(rect: Rect): RenderItem[] {
    this.#sync();
    const out: RenderItem[] = [];
    if (!this.#tree) return out;
    // The tree indexes bounds centers; expanding the search by the largest
    // half-extents guarantees no candidate with an intersecting box is missed.
    const x0 = rect.x - this.#maxHalfWidth;
    const y0 = rect.y - this.#maxHalfHeight;
    const x1 = rect.x + rect.width + this.#maxHalfWidth;
    const y1 = rect.y + rect.height + this.#maxHalfHeight;
    this.#tree.visit((node, nx0, ny0, nx1, ny1) => {
      if (!node.length) {
        let leaf: QuadtreeLeaf<RenderItem> | undefined = node as QuadtreeLeaf<RenderItem>;
        do {
          if (rectsIntersect(leaf.data.bounds, rect)) out.push(leaf.data);
          leaf = leaf.next;
        } while (leaf);
      }
      return nx0 > x1 || ny0 > y1 || nx1 < x0 || ny1 < y0;
    });
    return out.sort(compareRenderItems);
  }

  /** Every item under `point` (precise per-shape tests), top-most first. */
  hitTestAll(point: Point, options: HitTestOptions = {}): RenderItem[] {
    const tolerance = options.tolerance ?? 0;
    this.#sync();
    // Strokes paint outside item bounds, so widen the candidate box by the
    // largest half stroke in the scene — misses nothing, filters plenty.
    const slop = tolerance + this.#maxStroke / 2;
    return pickTopmost(
      this.query({
        x: point.x - slop,
        y: point.y - slop,
        width: 2 * slop,
        height: 2 * slop,
      }),
      point,
      options,
    );
  }

  /** The top-most item under `point`, or `null`. */
  hitTest(point: Point, options: HitTestOptions = {}): RenderItem | null {
    return this.hitTestAll(point, options)[0] ?? null;
  }

  #sync(): void {
    if (this.#revision === this.#scene.revision) return;
    this.#revision = this.#scene.revision;
    this.#maxHalfWidth = 0;
    this.#maxHalfHeight = 0;
    this.#maxStroke = 0;
    const items = this.#scene.items();
    for (const item of items) {
      this.#maxHalfWidth = Math.max(this.#maxHalfWidth, item.bounds.width / 2);
      this.#maxHalfHeight = Math.max(this.#maxHalfHeight, item.bounds.height / 2);
      this.#maxStroke = Math.max(this.#maxStroke, item.style.strokeWidth);
    }
    this.#tree =
      items.length === 0
        ? null
        : quadtree(
            items as RenderItem[],
            (item) => item.bounds.x + item.bounds.width / 2,
            (item) => item.bounds.y + item.bounds.height / 2,
          );
  }
}
