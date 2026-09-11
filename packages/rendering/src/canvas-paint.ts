import type { Point } from '@graphloom/core';
import type { LodLevel } from './frame.js';
import { pathData, segmentData } from './path-data.js';
import type { RenderItem, ResolvedStyle } from './scene.js';
import type { Rect } from './geometry.js';

// Shared by the live Canvas renderer (canvas.ts) and the PNG exporter
// (png-export.ts, P10-T04) — one Path2D/paint-attribute implementation per
// item kind, painted onto whatever CanvasRenderingContext2D the caller owns.
// Extracted from canvas.ts (P9-T01) the same way path-data.ts was pulled out
// of svg.ts: internal-only, zero public API change.

/** Rotation about the item's pivot (default: rect center), matching the SVG backend. */
export const withRotation = (
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
export const shapePath = (item: RenderItem & { kind: 'shape' }): Path2D => {
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

/**
 * Fills the path unless the resolved fill is `none`. SVG honours
 * `fill="none"`; a canvas `fillStyle = 'none'` is an invalid colour that is
 * silently ignored, leaving the previous fill in force — so an unguarded
 * `fill()` here paints stroked-only shapes (e.g. the `api` glyph) solid black.
 */
export const fillPath = (ctx: CanvasRenderingContext2D, fill: string, path: Path2D): void => {
  if (fill === 'none') return;
  ctx.fillStyle = fill;
  ctx.fill(path);
};

/** At dot LOD strokes are noise (matches the SVG backend); solid stroke/dash otherwise. */
export const strokeIfNeeded = (
  ctx: CanvasRenderingContext2D,
  style: ResolvedStyle,
  lod: LodLevel,
  path: Path2D,
): void => {
  if (lod === 'dot' || style.stroke === 'none') return;
  ctx.strokeStyle = style.stroke;
  ctx.lineWidth = style.strokeWidth;
  ctx.setLineDash(style.strokeDasharray ? [...style.strokeDasharray] : []);
  ctx.stroke(path);
};

/**
 * Draws the image scaled to fit `rect` preserving aspect ratio, centred —
 * matching the SVG backend's explicit `preserveAspectRatio="xMidYMid meet"`
 * on `<image>`. A bare `drawImage(img, x, y, w, h)` stretches to fill.
 */
export const drawImageContained = (
  ctx: CanvasRenderingContext2D,
  img: HTMLImageElement,
  rect: Rect,
): void => {
  const scale = Math.min(rect.width / img.naturalWidth, rect.height / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, rect.x + (rect.width - w) / 2, rect.y + (rect.height - h) / 2, w, h);
};

/** Paints one render item. Isolated by `save`/`restore` so styles never leak between items. */
export const drawItem = (
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
        fillPath(ctx, item.style.fill, path);
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
          drawImageContained(ctx, img, item.rect);
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
        fillPath(ctx, item.style.fill, path);
        strokeIfNeeded(ctx, item.style, lod, path);
      });
      break;
    case 'port': {
      const path = new Path2D();
      path.arc(item.center.x, item.center.y, item.radius, 0, Math.PI * 2);
      fillPath(ctx, item.style.fill, path);
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
