import { Emitter, type Unsubscribe } from '@graphloom/core';
import type { SpatialIndex, ViewportController } from '@graphloom/rendering';
import type { SnapProvider } from './drag.js';

/**
 * A live alignment guide (P4-T06): a world-space axis line renderers draw in
 * the overlay layer. Pure UI data — guides are never scene items, so they
 * can never leak into exports or hit tests.
 */
export interface SnapGuide {
  /** `x` = vertical line at `value`; `y` = horizontal line at `value`. */
  readonly axis: 'x' | 'y';
  readonly value: number;
}

/** Options for {@link Snapper}. */
export interface SnapOptions {
  /** Grid cell size in world units; `null` disables grid snapping. Default 20. */
  readonly gridSize?: number | null;
  /** Snap to other nodes' edges/centers. Default true. */
  readonly objects?: boolean;
  /** Snap radius in **screen** pixels (constant feel at any zoom). Default 8. */
  readonly radius?: number;
}

/** Events emitted by {@link Snapper}. */
export interface SnapEventMap {
  /** Active alignment guides changed (empty when nothing snaps). */
  'guides.changed': { readonly guides: readonly SnapGuide[] };
}

interface AxisSnap {
  delta: number;
  guide: SnapGuide | null;
}

/**
 * Grid and object snapping for drags (P4-T06). Plugs into
 * {@link DragController} as its {@link SnapProvider}; object candidates come
 * from the spatial index over the visible world rect (ADR-0007 keeps that
 * cheap). Alt passes through unsnapped (the provider's `disabled` flag).
 */
export class Snapper {
  #spatial: SpatialIndex;
  #viewport: ViewportController;
  #gridSize: number | null;
  #objects: boolean;
  #radius: number;
  #emitter = new Emitter<SnapEventMap>();
  #guides: readonly SnapGuide[] = [];

  constructor(spatial: SpatialIndex, viewport: ViewportController, options: SnapOptions = {}) {
    this.#spatial = spatial;
    this.#viewport = viewport;
    this.#gridSize = options.gridSize === undefined ? 20 : options.gridSize;
    this.#objects = options.objects ?? true;
    this.#radius = options.radius ?? 8;
  }

  /** Currently active guides. */
  get guides(): readonly SnapGuide[] {
    return this.#guides;
  }

  /** Subscribes to snap events; returns an unsubscriber. */
  on<K extends keyof SnapEventMap>(
    type: K,
    handler: (payload: SnapEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** The {@link SnapProvider} to hand to a `DragController`. */
  provider(): SnapProvider {
    return (offset, ctx) => {
      if (ctx.disabled) {
        this.#setGuides([]);
        return offset;
      }
      const radius = this.#radius / this.#viewport.viewport.zoom;
      const b = ctx.bounds;
      const xCandidates = [b.x, b.x + b.width / 2, b.x + b.width];
      const yCandidates = [b.y, b.y + b.height / 2, b.y + b.height];
      const { xTargets, yTargets } = this.#objectTargets(ctx.nodeIds);
      const sx = this.#snapAxis(xCandidates, xTargets, radius, 'x');
      const sy = this.#snapAxis(yCandidates, yTargets, radius, 'y');
      this.#setGuides([sx.guide, sy.guide].filter((g): g is SnapGuide => g !== null));
      return { x: offset.x + sx.delta, y: offset.y + sy.delta };
    };
  }

  /** Clears active guides (call when a drag ends or is cancelled). */
  clear(): void {
    this.#setGuides([]);
  }

  /**
   * Best snap for one axis: the smallest in-radius correction over object
   * targets (which win a guide line) and the grid (no guide — the grid is
   * already visible).
   */
  #snapAxis(candidates: number[], targets: number[], radius: number, axis: 'x' | 'y'): AxisSnap {
    let best: AxisSnap = { delta: 0, guide: null };
    let bestDist = radius;
    for (const c of candidates) {
      for (const t of targets) {
        const d = Math.abs(t - c);
        if (d < bestDist) {
          bestDist = d;
          best = { delta: t - c, guide: { axis, value: t } };
        }
      }
      if (this.#gridSize !== null && this.#gridSize > 0) {
        const t = Math.round(c / this.#gridSize) * this.#gridSize;
        const d = Math.abs(t - c);
        if (d < bestDist) {
          bestDist = d;
          best = { delta: t - c, guide: null };
        }
      }
    }
    return best;
  }

  /** Edge/center lines of visible, non-dragged nodes. */
  #objectTargets(excludeIds: readonly string[]): { xTargets: number[]; yTargets: number[] } {
    const xTargets: number[] = [];
    const yTargets: number[] = [];
    if (!this.#objects) return { xTargets, yTargets };
    const exclude = new Set(excludeIds);
    for (const item of this.#spatial.query(this.#viewport.visibleWorldRect())) {
      if (item.element !== 'node' || item.kind !== 'shape' || exclude.has(item.elementId)) {
        continue;
      }
      const b = item.bounds;
      xTargets.push(b.x, b.x + b.width / 2, b.x + b.width);
      yTargets.push(b.y, b.y + b.height / 2, b.y + b.height);
    }
    return { xTargets, yTargets };
  }

  #setGuides(guides: readonly SnapGuide[]): void {
    const same =
      guides.length === this.#guides.length &&
      guides.every(
        (g, i) => g.axis === this.#guides[i]?.axis && g.value === this.#guides[i]?.value,
      );
    if (same) return;
    this.#guides = guides;
    this.#emitter.emit('guides.changed', { guides });
  }
}
