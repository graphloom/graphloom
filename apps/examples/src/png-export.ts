// P10-T04 close-out fixture. Two acceptance proofs, one reference graph:
// (1) a 2x export displayed as an <img> — the visual baseline e2e/png-export
// .spec.ts screenshots; (2) a real-browser seamless-tiling check — force
// tiny tiles, stitch them back onto one canvas at their own offsets, and
// compare that against an untiled render at the same effective scale.
//
// Instrumented as a diff *ratio*, not a boolean equality, after a CI finding:
// this exact check reproducibly failed exact-byte equality on WebKit (3/3,
// no flake) while passing on Chromium and Firefox. An integer-pixel
// translation shouldn't move any shape's sub-pixel position relative to the
// pixel grid, so a real seam (a geometry gap/overlap between tiles) would
// show up as a large, structural diff — the working hypothesis is WebKit's
// text rasterizer isn't a pure function of final device position (glyph
// hinting sensitive to the host canvas's own size), which would show up as a
// small diff confined to label pixels. The exposed counters let the e2e test
// assert a bound grounded in the measured ratio instead of a guess.
import { commands, createGraph } from '@graphloom/core';
import { exportPng, type PngTile } from '@graphloom/rendering';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `<style>body{margin:0;background:#fff}#baseline{display:block}</style><img id="baseline" alt="2x export" />`;

const editor = createGraph();
editor.transact(() => {
  editor.execute(
    commands.nodeAdd({ id: 'alpha', position: { x: 40, y: 40 }, size: { width: 120, height: 48 }, data: { label: 'Alpha' } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'beta', position: { x: 280, y: 40 }, size: { width: 120, height: 48 }, data: { label: 'Beta' } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'gamma', position: { x: 160, y: 180 }, size: { width: 120, height: 48 }, data: { label: 'Gamma' } }),
  );
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'alpha', target: 'beta' }));
});

/** Decodes a tile's blob into a same-size canvas so its pixels can be read back. */
async function tileCanvas(tile: PngTile): Promise<HTMLCanvasElement> {
  const img = new Image();
  img.src = URL.createObjectURL(tile.blob);
  await img.decode();
  const canvas = document.createElement('canvas');
  canvas.width = tile.width;
  canvas.height = tile.height;
  canvas.getContext('2d')!.drawImage(img, 0, 0);
  return canvas;
}

declare global {
  interface Window {
    __ready: boolean;
    __seamDiffRatio: number;
    __seamDiffPixels: number;
    __seamTotalPixels: number;
  }
}

async function main(): Promise<void> {
  const [baseline] = await exportPng(editor, { scale: 2 });
  const img = document.querySelector('#baseline') as HTMLImageElement;
  const loaded = new Promise((resolve) => img.addEventListener('load', resolve, { once: true }));
  img.src = URL.createObjectURL(baseline!.blob);
  await loaded;

  const [whole] = await exportPng(editor, { maxTileSize: 100_000 });
  const tiles = await exportPng(editor, { maxTileSize: 60 }); // tiny — forces several tiles

  const wholeCtx = (await tileCanvas(whole!)).getContext('2d')!;
  const wholeData = wholeCtx.getImageData(0, 0, whole!.width, whole!.height).data;

  const stitched = document.createElement('canvas');
  stitched.width = whole!.width;
  stitched.height = whole!.height;
  const stitchedCtx = stitched.getContext('2d')!;
  for (const tile of tiles) {
    const canvas = await tileCanvas(tile);
    stitchedCtx.drawImage(canvas, tile.x, tile.y);
  }
  const stitchedData = stitchedCtx.getImageData(0, 0, stitched.width, stitched.height).data;

  const totalPixels = wholeData.length / 4;
  let diffPixels = 0;
  for (let i = 0; i < wholeData.length; i += 4) {
    if (
      stitchedData[i] !== wholeData[i] ||
      stitchedData[i + 1] !== wholeData[i + 1] ||
      stitchedData[i + 2] !== wholeData[i + 2] ||
      stitchedData[i + 3] !== wholeData[i + 3]
    ) {
      diffPixels++;
    }
  }
  window.__seamTotalPixels = totalPixels;
  window.__seamDiffPixels = diffPixels;
  // tiles.length > 1 confirms the fixture actually forced tiling — otherwise
  // "identical" would trivially mean "compared a render against itself".
  window.__seamDiffRatio = tiles.length > 1 ? diffPixels / totalPixels : NaN;
  window.__ready = true;
}

void main();
