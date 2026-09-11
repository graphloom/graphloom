import type { GraphEditor, Theme } from '@graphloom/core';
import { lightTheme } from '@graphloom/themes';
import { drawItem } from './canvas-paint.js';
import { inflateRect, rectsIntersect, type Rect } from './geometry.js';
import { SceneGraph, type ImageRenderItem, type RenderItem } from './scene.js';

/** Options for {@link exportPng}. */
export interface PngExportOptions {
  /** Theme to resolve styles against (default: the built-in light theme). */
  readonly theme?: Theme;
  /**
   * World-space rect to export ("viewport crop"). Default: the whole graph's
   * bounds, grown by `padding`. Items entirely outside it are omitted.
   */
  readonly bounds?: Rect;
  /** World-unit margin added around the full-graph bounds. Ignored when `bounds` is given. Default 40. */
  readonly padding?: number;
  /**
   * Background fill. Default: the theme's `background` token. `null` leaves
   * the canvas transparent.
   */
  readonly background?: string | null;
  /** Output pixels per world unit (like a device pixel ratio). Default 1. */
  readonly scale?: number;
  /**
   * Maximum canvas dimension per side. Default 4096 — conservative across
   * browsers, notably below Safari's lower canvas-size ceiling (tracker risk
   * note). Bounds whose scaled size exceeds this are split into multiple tiles.
   */
  readonly maxTileSize?: number;
}

/**
 * One tile of a (possibly multi-tile) {@link exportPng} result, positioned in
 * output-pixel space. The common case is a single tile covering the whole image.
 */
export interface PngTile {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
  readonly blob: Blob;
}

interface TileRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

const FALLBACK_BOUNDS: Rect = { x: 0, y: 0, width: 400, height: 300 };
const DEFAULT_PADDING = 40;
const DEFAULT_MAX_TILE_SIZE = 4096;

/** Splits an output image into a grid of tiles no larger than `maxTileSize` per side. */
function tileGrid(totalWidth: number, totalHeight: number, maxTileSize: number): TileRect[] {
  const cols = Math.ceil(totalWidth / maxTileSize);
  const rows = Math.ceil(totalHeight / maxTileSize);
  const tiles: TileRect[] = [];
  for (let row = 0; row < rows; row++) {
    for (let col = 0; col < cols; col++) {
      const x = col * maxTileSize;
      const y = row * maxTileSize;
      tiles.push({
        x,
        y,
        width: Math.min(maxTileSize, totalWidth - x),
        height: Math.min(maxTileSize, totalHeight - y),
      });
    }
  }
  return tiles;
}

/**
 * Decodes every unique image href `items` references and returns a
 * synchronous lookup — a one-shot rasterization gets no second frame to
 * retry a still-loading image on, unlike the live Canvas backend.
 */
async function preloadImages(
  items: readonly RenderItem[],
): Promise<(href: string) => HTMLImageElement | null> {
  const hrefs = new Set(
    items.filter((item): item is ImageRenderItem => item.kind === 'image').map((item) => item.href),
  );
  const images = new Map<string, HTMLImageElement>();
  await Promise.all(
    [...hrefs].map(async (href) => {
      const img = new Image();
      img.src = href;
      try {
        await img.decode();
        images.set(href, img);
      } catch {
        // Broken image: rendered as nothing, matching the live Canvas
        // backend's cache-miss behavior for a failed load.
      }
    }),
  );
  return (href) => images.get(href) ?? null;
}

function toPngBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (blob) resolve(blob);
      else reject(new Error('canvas.toBlob returned null'));
    }, 'image/png');
  });
}

/**
 * Rasterizes a graph to one or more PNG tiles — from the scene graph
 * directly, reusing the exact paint code the live Canvas backend uses
 * (`canvas-paint.ts`, shared since this task), so pixel output matches it by
 * construction (ADR-0002). Tiles past `maxTileSize` per side so no single
 * canvas ever exceeds a browser's size limit; the common case returns
 * exactly one tile covering the whole image. There is no way to *compose*
 * oversized tiles back into a single PNG without a real image-encoding
 * library (this repo has none, deliberately) — a caller needing one output
 * file stitches the tiles itself (a print layout, a server-side image tool).
 */
export async function exportPng(
  editor: GraphEditor,
  options: PngExportOptions = {},
): Promise<readonly PngTile[]> {
  const theme = options.theme ?? lightTheme;
  const scale = options.scale ?? 1;
  const maxTileSize = options.maxTileSize ?? DEFAULT_MAX_TILE_SIZE;
  const scene = new SceneGraph(editor, { theme });
  try {
    const full = scene.bounds();
    const bounds =
      options.bounds ?? (full ? inflateRect(full, options.padding ?? DEFAULT_PADDING) : FALLBACK_BOUNDS);
    const items = scene.items().filter((item) => rectsIntersect(item.bounds, bounds));
    const background = options.background === undefined ? theme.tokens.background : options.background;
    const loadImage = await preloadImages(items);
    const markerPaths = new Map<string, Path2D>();

    const totalWidth = Math.max(1, Math.round(bounds.width * scale));
    const totalHeight = Math.max(1, Math.round(bounds.height * scale));

    const tiles: PngTile[] = [];
    for (const tile of tileGrid(totalWidth, totalHeight, maxTileSize)) {
      const canvas = document.createElement('canvas');
      canvas.width = tile.width;
      canvas.height = tile.height;
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('exportPng: no 2D canvas context available');
      if (background !== null) {
        ctx.fillStyle = background;
        ctx.fillRect(0, 0, tile.width, tile.height);
      }
      // World units -> output pixels, then shift so this tile's own
      // top-left corner lands at the canvas origin.
      ctx.setTransform(scale, 0, 0, scale, -bounds.x * scale - tile.x, -bounds.y * scale - tile.y);
      const tileWorldBounds: Rect = {
        x: bounds.x + tile.x / scale,
        y: bounds.y + tile.y / scale,
        width: tile.width / scale,
        height: tile.height / scale,
      };
      for (const item of items) {
        if (rectsIntersect(item.bounds, tileWorldBounds)) drawItem(ctx, item, 'full', loadImage, markerPaths);
      }
      tiles.push({
        x: tile.x,
        y: tile.y,
        width: tile.width,
        height: tile.height,
        blob: await toPngBlob(canvas),
      });
    }
    return tiles;
  } finally {
    scene.destroy();
  }
}
