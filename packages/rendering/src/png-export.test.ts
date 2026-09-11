// @vitest-environment jsdom
import { createGraph } from '@graphloom/core';
import { darkTheme } from '@graphloom/themes';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { exportPng } from './png-export.js';

// jsdom has no real 2D context (`getContext('2d')` returns null — same gap
// canvas.test.ts works around) and no Path2D at all, so these tests drive an
// *empty* graph through a recording fake context: no shape/text/edge items
// ever reach `drawItem`, which keeps the orchestration this task actually
// adds (tile math, background, scale transform, blob wiring) provable here
// without needing a real browser. Per-item painting reuses canvas.ts's own
// `drawItem` verbatim (canvas-paint.ts) — its correctness is canvas.test.ts's
// job, not this file's — and the first real-pixel proof is the e2e close-out,
// same discipline as P9-T01.
const calls: string[] = [];
const fakeCtx = new Proxy(
  {},
  {
    get(_t, prop: string) {
      return (...args: unknown[]) => {
        calls.push(`${prop}(${args.join(',')})`);
        return undefined;
      };
    },
    set(_t, prop: string, value: unknown) {
      calls.push(`${prop}=${value}`);
      return true;
    },
  },
) as unknown as CanvasRenderingContext2D;

const FAKE_BLOB = new Blob(['png-bytes']);

afterEach(() => {
  calls.length = 0;
  vi.restoreAllMocks();
});

const mockCanvas = (ctx: CanvasRenderingContext2D | null = fakeCtx): void => {
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(ctx);
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
    this: HTMLCanvasElement,
    cb: BlobCallback,
  ) {
    cb(FAKE_BLOB);
  });
};

describe('exportPng', () => {
  it('defaults to a single tile at the fallback bounds for an empty graph', async () => {
    mockCanvas();
    const tiles = await exportPng(createGraph());
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, width: 400, height: 300 });
    expect(tiles[0]!.blob).toBe(FAKE_BLOB);
  });

  it('uses an explicit bounds rect for the output size', async () => {
    mockCanvas();
    const tiles = await exportPng(createGraph(), { bounds: { x: 10, y: 20, width: 200, height: 100 } });
    expect(tiles).toHaveLength(1);
    expect(tiles[0]).toMatchObject({ x: 0, y: 0, width: 200, height: 100 });
  });

  it('multiplies output pixels by scale and encodes it in the paint transform', async () => {
    mockCanvas();
    const tiles = await exportPng(createGraph(), {
      bounds: { x: 10, y: 20, width: 200, height: 100 },
      scale: 2,
    });
    expect(tiles[0]).toMatchObject({ width: 400, height: 200 });
    // World -> output-pixel transform: scale 2, shifted by -bounds*scale.
    expect(calls).toContain('setTransform(2,0,0,2,-20,-40)');
  });

  it('fills the background from the theme by default, and skips it when null', async () => {
    mockCanvas();
    await exportPng(createGraph(), { bounds: { x: 0, y: 0, width: 10, height: 10 } });
    expect(calls).toContain('fillStyle=#ffffff'); // lightTheme default background
    expect(calls.some((c) => c.startsWith('fillRect'))).toBe(true);

    calls.length = 0;
    await exportPng(createGraph(), {
      theme: darkTheme,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(calls).toContain(`fillStyle=${darkTheme.tokens.background}`);

    calls.length = 0;
    await exportPng(createGraph(), {
      background: null,
      bounds: { x: 0, y: 0, width: 10, height: 10 },
    });
    expect(calls.some((c) => c.startsWith('fillStyle') || c.startsWith('fillRect'))).toBe(false);
  });

  it('splits an oversized image into a seam-correct tile grid', async () => {
    mockCanvas();
    const tiles = await exportPng(createGraph(), {
      bounds: { x: 0, y: 0, width: 900, height: 500 },
      maxTileSize: 400,
    });
    // ceil(900/400)=3 cols, ceil(500/400)=2 rows.
    expect(tiles).toHaveLength(6);
    expect(tiles.map(({ x, y, width, height }) => ({ x, y, width, height }))).toEqual([
      { x: 0, y: 0, width: 400, height: 400 },
      { x: 400, y: 0, width: 400, height: 400 },
      { x: 800, y: 0, width: 100, height: 400 }, // remainder column
      { x: 0, y: 400, width: 400, height: 100 }, // remainder row
      { x: 400, y: 400, width: 400, height: 100 },
      { x: 800, y: 400, width: 100, height: 100 }, // remainder corner
    ]);
    // Every tile paints its own slice shifted to its own canvas origin — no
    // gap or overlap between adjacent tiles' world-space coverage.
    const transforms = calls.filter((c) => c.startsWith('setTransform'));
    expect(transforms).toEqual([
      'setTransform(1,0,0,1,0,0)',
      'setTransform(1,0,0,1,-400,0)',
      'setTransform(1,0,0,1,-800,0)',
      'setTransform(1,0,0,1,0,-400)',
      'setTransform(1,0,0,1,-400,-400)',
      'setTransform(1,0,0,1,-800,-400)',
    ]);
  });

  it('rejects when the canvas has no 2D context available', async () => {
    mockCanvas(null);
    await expect(exportPng(createGraph())).rejects.toThrow(/no 2D canvas context/);
  });

  it('rejects when canvas.toBlob yields no blob', async () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(function (
      this: HTMLCanvasElement,
      cb: BlobCallback,
    ) {
      cb(null);
    });
    await expect(exportPng(createGraph())).rejects.toThrow(/toBlob returned null/);
  });
});
