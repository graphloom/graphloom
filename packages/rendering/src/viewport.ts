import { Emitter, type Point, type Size, type Unsubscribe, type Viewport } from '@graphloom/core';
import { clamp, type Rect } from './geometry.js';

/**
 * Events emitted by a {@link ViewportController}. The host mount (P3-T06+)
 * forwards `viewport.changed` to the editor's event surface.
 */
export interface ViewportEventMap {
  /** Any pan or zoom change (fires once per state change). */
  'viewport.changed': { readonly viewport: Viewport };
  /** Zoom level changed (subset of `viewport.changed`). */
  'zoom.changed': { readonly zoom: number; readonly previous: number };
}

/** Options for {@link ViewportController}. */
export interface ViewportOptions {
  /** Initial viewport (default identity: x 0, y 0, zoom 1). */
  readonly viewport?: Viewport;
  /** Screen size of the host in CSS pixels (default 0×0 until `setSize`). */
  readonly size?: Size;
  /** Smallest allowed zoom (default 0.1). */
  readonly minZoom?: number;
  /** Largest allowed zoom (default 8). */
  readonly maxZoom?: number;
}

/**
 * Pan/zoom state and math (ADR-0006: our own — no `d3-zoom`).
 *
 * Convention: `screen = world · zoom + (x, y)` — `x`/`y` are the screen-space
 * translation in CSS pixels, matching the persisted {@link Viewport} shape.
 */
export class ViewportController {
  #viewport: Viewport;
  #size: Size;
  #emitter = new Emitter<ViewportEventMap>();
  /** Smallest allowed zoom. */
  readonly minZoom: number;
  /** Largest allowed zoom. */
  readonly maxZoom: number;

  constructor(options: ViewportOptions = {}) {
    this.minZoom = options.minZoom ?? 0.1;
    this.maxZoom = options.maxZoom ?? 8;
    if (!(this.minZoom > 0) || this.minZoom > this.maxZoom) {
      throw new Error(`invalid zoom range [${this.minZoom}, ${this.maxZoom}]`);
    }
    const v = options.viewport ?? { x: 0, y: 0, zoom: 1 };
    this.#viewport = { ...v, zoom: clamp(v.zoom, this.minZoom, this.maxZoom) };
    this.#size = options.size ?? { width: 0, height: 0 };
  }

  /** Current viewport state. */
  get viewport(): Viewport {
    return this.#viewport;
  }

  /** Current host size in CSS pixels. */
  get size(): Size {
    return this.#size;
  }

  /** Subscribes to a viewport event; returns an unsubscriber. */
  on<K extends keyof ViewportEventMap>(
    type: K,
    handler: (payload: ViewportEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** Updates the host size (driven by resize observation in the host mount). */
  setSize(size: Size): void {
    this.#size = size;
  }

  /** Replaces the viewport state (zoom clamped to the allowed range). */
  setViewport(viewport: Viewport): void {
    this.#commit({ ...viewport, zoom: clamp(viewport.zoom, this.minZoom, this.maxZoom) });
  }

  /** Pans by a screen-space delta in CSS pixels. */
  panBy(dx: number, dy: number): void {
    const v = this.#viewport;
    this.#commit({ x: v.x + dx, y: v.y + dy, zoom: v.zoom });
  }

  /**
   * Sets the zoom level, keeping the world point under `about` (screen
   * coordinates; default viewport center) fixed on screen.
   */
  zoomTo(zoom: number, about?: Point): void {
    const v = this.#viewport;
    const target = clamp(zoom, this.minZoom, this.maxZoom);
    const s = about ?? { x: this.#size.width / 2, y: this.#size.height / 2 };
    // World point under the anchor stays put: t' = s − ((s − t) / k) · k'.
    this.#commit({
      x: s.x - ((s.x - v.x) / v.zoom) * target,
      y: s.y - ((s.y - v.y) / v.zoom) * target,
      zoom: target,
    });
  }

  /** Multiplies the zoom level (wheel/pinch steps), anchored like {@link zoomTo}. */
  zoomBy(factor: number, about?: Point): void {
    this.zoomTo(this.#viewport.zoom * factor, about);
  }

  /**
   * Fits `bounds` (world coordinates) into the host with `padding` CSS pixels
   * on every side. No-op when `bounds` is missing (empty graph) or the host
   * has no size yet. Zero-area bounds (a single point) center it at the
   * current zoom.
   */
  zoomToFit(bounds: Rect | null | undefined, padding = 20): void {
    if (!bounds || this.#size.width <= 0 || this.#size.height <= 0) return;
    const availW = Math.max(1, this.#size.width - 2 * padding);
    const availH = Math.max(1, this.#size.height - 2 * padding);
    const zoom =
      bounds.width > 0 || bounds.height > 0
        ? clamp(
            Math.min(
              bounds.width > 0 ? availW / bounds.width : Infinity,
              bounds.height > 0 ? availH / bounds.height : Infinity,
            ),
            this.minZoom,
            this.maxZoom,
          )
        : this.#viewport.zoom;
    this.#commit({
      x: this.#size.width / 2 - (bounds.x + bounds.width / 2) * zoom,
      y: this.#size.height / 2 - (bounds.y + bounds.height / 2) * zoom,
      zoom,
    });
  }

  /** Converts a world point to screen (CSS pixel) coordinates. */
  worldToScreen(p: Point): Point {
    const v = this.#viewport;
    return { x: p.x * v.zoom + v.x, y: p.y * v.zoom + v.y };
  }

  /** Converts a screen (CSS pixel) point to world coordinates. */
  screenToWorld(p: Point): Point {
    const v = this.#viewport;
    return { x: (p.x - v.x) / v.zoom, y: (p.y - v.y) / v.zoom };
  }

  /** The world-space rect currently covered by the host. */
  visibleWorldRect(): Rect {
    const v = this.#viewport;
    return {
      x: -v.x / v.zoom,
      y: -v.y / v.zoom,
      width: this.#size.width / v.zoom,
      height: this.#size.height / v.zoom,
    };
  }

  #commit(next: Viewport): void {
    const prev = this.#viewport;
    if (next.x === prev.x && next.y === prev.y && next.zoom === prev.zoom) return;
    this.#viewport = next;
    this.#emitter.emit('viewport.changed', { viewport: next });
    if (next.zoom !== prev.zoom) {
      this.#emitter.emit('zoom.changed', { zoom: next.zoom, previous: prev.zoom });
    }
  }
}
