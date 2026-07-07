import type { Viewport } from '@graphloom/core';
import { inflateRect } from './geometry.js';
import type { RenderItem, RenderItemId, SceneDirty } from './scene.js';
import type { SpatialIndex } from './spatial.js';
import type { ViewportController } from './viewport.js';

/** Level of detail for a frame, derived from zoom (renderer hints). */
export type LodLevel = 'full' | 'simplified' | 'dot';

/**
 * One renderer input (ADR-0002): the culled scene + dirty set + viewport +
 * device pixel ratio. `dirty` is relative to the previous frame from the same
 * {@link FrameBuilder} — culling enter/leave shows up as added/removed.
 */
export interface SceneFrame {
  /** Visible items (viewport ∩ margin, LOD-filtered), in paint order. */
  readonly items: readonly RenderItem[];
  /** Changes since the previous frame, in terms of visible items. */
  readonly dirty: SceneDirty;
  readonly viewport: Viewport;
  readonly devicePixelRatio: number;
  readonly lod: LodLevel;
}

/** Options for {@link FrameBuilder}. */
export interface FrameOptions {
  /** Culling margin in screen px around the viewport (default 100 — no pop-in). */
  readonly margin?: number;
  /** Below this zoom the frame is `simplified` (default 0.5). */
  readonly simplifiedBelow?: number;
  /** Below this zoom the frame is `dot` (default 0.2). */
  readonly dotBelow?: number;
  /** Below this zoom text items are dropped from frames (default 0.4). */
  readonly labelsBelow?: number;
}

/**
 * Produces {@link SceneFrame}s: region-queries the spatial index for the
 * viewport (+margin), applies LOD/label thresholds, and diffs against the
 * previous frame so renderers only patch what changed (P3-T05).
 *
 * Item updates are detected by object identity — the scene graph replaces
 * item objects on every change and never mutates them, so `!==` is exact.
 */
export class FrameBuilder {
  #index: SpatialIndex;
  #viewport: ViewportController;
  #options: Required<FrameOptions>;
  #lastVisible = new Map<RenderItemId, RenderItem>();
  #lastLod: LodLevel | null = null;

  constructor(index: SpatialIndex, viewport: ViewportController, options: FrameOptions = {}) {
    this.#index = index;
    this.#viewport = viewport;
    this.#options = {
      margin: options.margin ?? 100,
      simplifiedBelow: options.simplifiedBelow ?? 0.5,
      dotBelow: options.dotBelow ?? 0.2,
      labelsBelow: options.labelsBelow ?? 0.4,
    };
  }

  /** The LOD level for a zoom factor under this builder's thresholds. */
  lodFor(zoom: number): LodLevel {
    if (zoom < this.#options.dotBelow) return 'dot';
    if (zoom < this.#options.simplifiedBelow) return 'simplified';
    return 'full';
  }

  /** Builds the next frame for the current scene + viewport state. */
  frame(devicePixelRatio = 1): SceneFrame {
    const viewport = this.#viewport.viewport;
    const zoom = viewport.zoom;
    const lod = this.lodFor(zoom);
    const showLabels = zoom >= this.#options.labelsBelow;
    const region = inflateRect(this.#viewport.visibleWorldRect(), this.#options.margin / zoom);

    const items = this.#index
      .query(region)
      .filter((item) => showLabels || item.kind !== 'text');
    const visible = new Map(items.map((item) => [item.id, item] as const));

    // A LOD flip changes how every item paints → everything surviving is dirty.
    const repaintAll = this.#lastLod !== null && this.#lastLod !== lod;
    const added: RenderItemId[] = [];
    const updated: RenderItemId[] = [];
    const removed: RenderItemId[] = [];
    for (const [id, item] of visible) {
      const previous = this.#lastVisible.get(id);
      if (previous === undefined) added.push(id);
      else if (repaintAll || previous !== item) updated.push(id);
    }
    for (const id of this.#lastVisible.keys()) {
      if (!visible.has(id)) removed.push(id);
    }

    this.#lastVisible = visible;
    this.#lastLod = lod;
    return { items, dirty: { added, updated, removed }, viewport, devicePixelRatio, lod };
  }

  /** Forgets the previous frame: the next frame reports everything as added. */
  reset(): void {
    this.#lastVisible = new Map();
    this.#lastLod = null;
  }
}
