import type { Point, Size } from '@graphloom/core';
import type { LodLevel, SceneFrame } from './frame.js';
import { inflateRect, rectsIntersect, unionRects, type Rect } from './geometry.js';
import { pathData, segmentData } from './path-data.js';
import { hitTestFrame, type Renderer } from './renderer.js';
import type { RenderItem, RenderItemId, ResolvedStyle } from './scene.js';
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

/** Rotation about the item's pivot (default: rect center), matching the SVG backend. */
const withRotation = (
  ctx: CanvasRenderingContext2D,
  rect: Rect,
  rotation: number,
  pivot: Point | undefined,
  draw: () => void,
): void => {
  if (rotation % 360 === 0) {
    draw();
    return;
  }
  const cx = pivot?.x ?? rect.x + rect.width / 2;
  const cy = pivot?.y ?? rect.y + rect.height / 2;
  ctx.save();
  ctx.translate(cx, cy);
  ctx.rotate((rotation * Math.PI) / 180);
  ctx.translate(-cx, -cy);
  draw();
  ctx.restore();
};

/** Builds the fill/stroke geometry for a shape item's primitive kind. */
const shapePath = (item: RenderItem & { kind: 'shape' }): Path2D => {
  const path = new Path2D();
  switch (item.shape) {
    case 'ellipse':
      path.ellipse(
        item.rect.x + item.rect.width / 2,
        item.rect.y + item.rect.height / 2,
        item.rect.width / 2,
        item.rect.height / 2,
        0,
        0,
        Math.PI * 2,
      );
      return path;
    case 'polygon': {
      const [first, ...rest] = item.points ?? [];
      if (first) {
        path.moveTo(first.x, first.y);
        for (const p of rest) path.lineTo(p.x, p.y);
        path.closePath();
      }
      return path;
    }
    case 'path':
      return new Path2D(segmentData(item.segments ?? []));
    case 'roundRect':
      path.roundRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height, item.radius ?? 0);
      return path;
    default:
      path.rect(item.rect.x, item.rect.y, item.rect.width, item.rect.height);
      return path;
  }
};

/** At dot LOD strokes are noise (matches the SVG backend); solid stroke/dash otherwise. */
const strokeIfNeeded = (
  ctx: CanvasRenderingContext2D,
  style: ResolvedStyle,
  lod: LodLevel,
  path: Path2D,
): void => {
  if (lod === 'dot') return;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.strokeWidth;
  ctx.setLineDash(style.strokeDasharray ? [...style.strokeDasharray] : []);
  ctx.stroke(path);
};

/** Paints one render item. Isolated by `save`/`restore` so styles never leak between items. */
const drawItem = (
  ctx: CanvasRenderingContext2D,
  item: RenderItem,
  lod: LodLevel,
  loadImage: (href: string) => HTMLImageElement | null,
  markerPaths: Map<string, Path2D>,
): void => {
  ctx.save();
  if (item.style.opacity !== undefined) ctx.globalAlpha = item.style.opacity;

  switch (item.kind) {
    case 'shape':
      withRotation(ctx, item.rect, item.rotation, item.pivot, () => {
        const path = shapePath(item);
        ctx.fillStyle = item.style.fill;
        ctx.fill(path);
        strokeIfNeeded(ctx, item.style, lod, path);
      });
      break;
    case 'path': {
      // Edge routes are stroked only (fill: none), same as the SVG backend.
      strokeIfNeeded(ctx, item.style, lod, new Path2D(pathData(item)));
      break;
    }
    case 'text':
      ctx.font = `${item.style.bold === true ? 'bold ' : ''}${item.style.fontSize}px ${item.style.fontFamily}`;
      ctx.fillStyle = item.style.textColor;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(item.text, item.position.x, item.position.y);
      break;
    case 'image': {
      // No stroke: the SVG backend's stroke attribute on <image> is a no-op there too.
      const img = loadImage(item.href);
      if (img) {
        withRotation(ctx, item.rect, item.rotation, item.pivot, () => {
          ctx.drawImage(img, item.rect.x, item.rect.y, item.rect.width, item.rect.height);
        });
      }
      break;
    }
    case 'icon':
      // ponytail: neutral rounded plate, matching the SVG placeholder; real
      // glyph resolution needs a host icon registry (close-out / P11 territory).
      withRotation(ctx, item.rect, item.rotation, item.pivot, () => {
        const path = new Path2D();
        path.roundRect(item.rect.x, item.rect.y, item.rect.width, item.rect.height, 4);
        ctx.fillStyle = item.style.fill;
        ctx.fill(path);
        strokeIfNeeded(ctx, item.style, lod, path);
      });
      break;
    case 'port': {
      const path = new Path2D();
      path.arc(item.center.x, item.center.y, item.radius, 0, Math.PI * 2);
      ctx.fillStyle = item.style.fill;
      ctx.fill(path);
      strokeIfNeeded(ctx, item.style, lod, path);
      break;
    }
    case 'marker': {
      // Unit-box geometry is static per marker name (P7-T06 registries are
      // static lookups) — cache the Path2D once instead of reparsing per frame.
      let markerPath = markerPaths.get(item.marker);
      if (!markerPath) {
        markerPath = new Path2D(segmentData(item.segments));
        markerPaths.set(item.marker, markerPath);
      }
      ctx.translate(item.at.x, item.at.y);
      ctx.rotate((item.angle * Math.PI) / 180);
      ctx.scale(item.size, item.size);
      if (item.filled) {
        ctx.fillStyle = item.style.fill;
        ctx.fill(markerPath);
      }
      if (lod !== 'dot') {
        // Stroke width/dash are applied inside the scaled marker space (matches SVG).
        ctx.strokeStyle = item.style.stroke;
        ctx.lineWidth = item.style.strokeWidth / item.size;
        ctx.setLineDash(
          item.style.strokeDasharray
            ? item.style.strokeDasharray.map((v) => v / item.size)
            : [],
        );
        ctx.stroke(markerPath);
      }
      break;
    }
  }
  ctx.restore();
};

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
    const currentById = new Map(frame.items.map((item) => [item.id, item] as const));
    const dirtyCount =
      frame.dirty.added.length + frame.dirty.updated.length + frame.dirty.removed.length;
    if (!forceFull && dirtyCount === 0) {
      previousItems = currentById;
      return;
    }

    const { x, y, zoom } = frame.viewport;
    ctx.setTransform(zoom * dpr, 0, 0, zoom * dpr, x * dpr, y * dpr);

    const full = forceFull || dirtyCount / Math.max(frame.items.length, 1) > dirtyRegionThreshold;
    if (full) {
      ctx.save();
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.restore(); // back to the world transform set above
      for (const item of frame.items) drawItem(ctx, item, frame.lod, loadImage, markerPaths);
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
      previousItems = new Map();
      markerPaths.clear();
      images.clear();
    },
  };
}
