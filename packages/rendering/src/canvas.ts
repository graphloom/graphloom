import type { Size } from '@graphloom/core';
import { drawItem } from './canvas-paint.js';
import type { SceneFrame } from './frame.js';
import { inflateRect, rectsIntersect, unionRects, type Rect } from './geometry.js';
import { hitTestFrame, type Renderer } from './renderer.js';
import type { RenderItem, RenderItemId } from './scene.js';
import { createTextMeasurer, type TextStyle } from './text.js';

/** Options for {@link createCanvasRenderer}. */
export interface CanvasRendererOptions {
  /**
   * Full-frame clear+redraw kicks in once the dirty item count exceeds this
   * fraction of visible items; below it, only the dirty items' (inflated)
   * screen bounds are cleared and redrawn. `0` always does a full repaint.
   * Default 0.4.
   */
  readonly dirtyRegionThreshold?: number;
}

const DEFAULT_DIRTY_REGION_THRESHOLD = 0.4;
// World-unit margin around a dirty region's item bounds: cheap, style-
// agnostic slop covering stroke width and rotation without inspecting every
// dirty item's own stroke width. Widen if partial-repaint edge clipping ever
// shows up in visual review.
const DIRTY_MARGIN = 8;

/**
 * The Canvas 2D rendering backend (ADR-0002, P9-T01). Immediate-mode: every
 * repaint redraws whatever items fall in the affected region in paint order
 * (`frame.items` is already sorted — see {@link SpatialIndex.query}). Owns
 * HiDPI backing-store sizing itself (frame.devicePixelRatio in, `setTransform`
 * folds DPR and pan/zoom into one matrix); SVG needs neither since vector
 * output is resolution-independent (P3-T09 grid + the default edge-arrow
 * decoration are SVG-only presentation extras, not part of the Renderer
 * contract — see the P9-T02 close-out note for parity status).
 */
export function createCanvasRenderer(options: CanvasRendererOptions = {}): Renderer {
  const measure = createTextMeasurer();
  const dirtyRegionThreshold = options.dirtyRegionThreshold ?? DEFAULT_DIRTY_REGION_THRESHOLD;
  const markerPaths = new Map<string, Path2D>();
  const images = new Map<string, HTMLImageElement>();
  let host: HTMLElement | null = null;
  let canvas: HTMLCanvasElement | null = null;
  let ctx: CanvasRenderingContext2D | null = null;
  let lastFrame: SceneFrame | null = null;
  let previousItems = new Map<RenderItemId, RenderItem>();
  let cssWidth = -1;
  let cssHeight = -1;
  let dpr = -1;
  // The viewport the canvas currently reflects. A pan/zoom moves every pixel
  // but dirties no items (FrameBuilder keeps object identity across a viewport
  // change), so an immediate-mode backend must treat any viewport change as a
  // full-frame invalidation — the retained-mode SVG backend gets this for free
  // by updating one <g transform> and letting the browser recomposite.
  let paintedViewport: { x: number; y: number; zoom: number } | null = null;

  /** Repaints with whatever frame was last given (image finished loading async). */
  const repaint = (): void => {
    if (lastFrame) paintFrame(lastFrame, true);
  };

  /** Image bitmap cache: returns the loaded element, or `null` while it decodes. */
  const loadImage = (href: string): HTMLImageElement | null => {
    const cached = images.get(href);
    if (cached) return cached.complete && cached.naturalWidth > 0 ? cached : null;
    const img = new Image();
    images.set(href, img);
    img.src = href;
    img.decode().then(repaint).catch(() => {
      // Broken image: stays cached so a bad href isn't retried every frame.
    });
    return null;
  };

  /** Resizes the backing store to the host's current CSS size × DPR. */
  const resizeIfNeeded = (frameDpr: number): boolean => {
    if (!canvas || !host) return false;
    const w = host.clientWidth;
    const h = host.clientHeight;
    if (w === cssWidth && h === cssHeight && frameDpr === dpr) return false;
    cssWidth = w;
    cssHeight = h;
    dpr = frameDpr;
    // Assigning width/height also clears the canvas — the caller must treat
    // this as forcing a full repaint regardless of the frame's dirty set.
    canvas.width = Math.max(1, Math.round(w * dpr));
    canvas.height = Math.max(1, Math.round(h * dpr));
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    return true;
  };

  const paintFrame = (frame: SceneFrame, forceFull: boolean): void => {
    if (!ctx || !canvas) return;
    // Re-bound as const so the nested repaint helpers below get the non-null
    // narrowing (a captured `let` doesn't narrow inside a closure).
    const c = canvas;
    const g = ctx;
    const currentById = new Map(frame.items.map((item) => [item.id, item] as const));
    const dirtyCount =
      frame.dirty.added.length + frame.dirty.updated.length + frame.dirty.removed.length;
    const { x, y, zoom } = frame.viewport;
    const viewportChanged =
      !paintedViewport ||
      paintedViewport.x !== x ||
      paintedViewport.y !== y ||
      paintedViewport.zoom !== zoom;
    const panned = paintedViewport?.zoom === zoom && viewportChanged;

    if (!forceFull && !viewportChanged && dirtyCount === 0) {
      previousItems = currentById;
      return;
    }

    const worldTransform = (): void => {
      g.setTransform(zoom * dpr, 0, 0, zoom * dpr, x * dpr, y * dpr);
    };
    /**
     * Redraws items intersecting a screen-space rect, clipped to it. The rect
     * is grown 1px into the blitted region first, so any anti-aliased edge
     * straddling the pan seam is repainted rather than left doubled.
     */
    const paintScreenRect = (sx: number, sy: number, sw: number, sh: number): void => {
      const world: Rect = {
        x: (sx - 1 - x) / zoom,
        y: (sy - 1 - y) / zoom,
        width: (sw + 2) / zoom,
        height: (sh + 2) / zoom,
      };
      g.save();
      g.beginPath();
      g.rect(world.x, world.y, world.width, world.height);
      g.clip();
      g.clearRect(world.x, world.y, world.width, world.height);
      for (const item of frame.items) {
        if (rectsIntersect(item.bounds, world)) {
          drawItem(g, item, frame.lod, loadImage, markerPaths);
        }
      }
      g.restore();
    };
    const fullRepaint = (): void => {
      g.setTransform(1, 0, 0, 1, 0, 0);
      g.clearRect(0, 0, c.width, c.height);
      worldTransform();
      for (const item of frame.items) drawItem(g, item, frame.lod, loadImage, markerPaths);
    };

    // Pure pan (zoom unchanged, nothing dirty): shift the current pixels by the
    // device-space delta and repaint only the L-shaped strip the shift exposed
    // — the immediate-mode equivalent of the SVG backend moving one <g
    // transform> and letting the browser recomposite.
    if (!forceFull && panned && dirtyCount === 0 && paintedViewport) {
      const dx = Math.round((x - paintedViewport.x) * dpr);
      const dy = Math.round((y - paintedViewport.y) * dpr);
      paintedViewport = { x, y, zoom };
      if (Math.abs(dx) >= c.width || Math.abs(dy) >= c.height) {
        // Panned past a full viewport — nothing on screen is worth keeping.
        fullRepaint();
      } else {
        g.setTransform(1, 0, 0, 1, 0, 0);
        g.drawImage(c, dx, dy);
        worldTransform();
        if (dx > 0) paintScreenRect(0, 0, dx / dpr, cssHeight);
        else if (dx < 0) paintScreenRect(cssWidth + dx / dpr, 0, -dx / dpr, cssHeight);
        if (dy > 0) paintScreenRect(0, 0, cssWidth, dy / dpr);
        else if (dy < 0) paintScreenRect(0, cssHeight + dy / dpr, cssWidth, -dy / dpr);
      }
      previousItems = currentById;
      return;
    }

    worldTransform();
    paintedViewport = { x, y, zoom };

    const full =
      forceFull ||
      viewportChanged ||
      dirtyCount / Math.max(frame.items.length, 1) > dirtyRegionThreshold;
    if (full) {
      fullRepaint();
    } else {
      let region: Rect | null = null;
      const grow = (r: Rect): void => {
        region = region ? unionRects(region, r) : r;
      };
      for (const id of [...frame.dirty.added, ...frame.dirty.updated]) {
        const item = currentById.get(id);
        if (item) grow(item.bounds);
      }
      for (const id of [...frame.dirty.updated, ...frame.dirty.removed]) {
        const previous = previousItems.get(id);
        if (previous) grow(previous.bounds);
      }
      if (region) {
        const dirtyRect = inflateRect(region, DIRTY_MARGIN);
        ctx.save();
        ctx.beginPath();
        ctx.rect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
        ctx.clip();
        ctx.clearRect(dirtyRect.x, dirtyRect.y, dirtyRect.width, dirtyRect.height);
        for (const item of frame.items) {
          if (rectsIntersect(item.bounds, dirtyRect)) {
            drawItem(ctx, item, frame.lod, loadImage, markerPaths);
          }
        }
        ctx.restore();
      }
    }
    previousItems = currentById;
  };

  return {
    mount(hostEl) {
      host = hostEl;
      canvas = document.createElement('canvas');
      canvas.setAttribute('data-graphloom', 'canvas');
      canvas.style.display = 'block';
      canvas.style.width = '100%';
      canvas.style.height = '100%';
      ctx = canvas.getContext('2d');
      cssWidth = -1;
      cssHeight = -1;
      dpr = -1;
      paintedViewport = null;
      previousItems = new Map();
      host.appendChild(canvas);
    },

    render(frame) {
      if (!canvas) throw new Error('render() before mount()');
      const resized = resizeIfNeeded(frame.devicePixelRatio);
      lastFrame = frame;
      if (!ctx) return; // no 2D context available (e.g. jsdom) — hit testing still works
      paintFrame(frame, resized);
    },

    hitTest(point) {
      return hitTestFrame(lastFrame, point);
    },

    measureText(text: string, style: TextStyle): Size {
      return measure(text, style);
    },

    destroy() {
      canvas?.remove();
      canvas = null;
      ctx = null;
      host = null;
      lastFrame = null;
      paintedViewport = null;
      previousItems = new Map();
      markerPaths.clear();
      images.clear();
    },
  };
}
