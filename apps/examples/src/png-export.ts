// P10-T04 close-out fixture. Two acceptance proofs, one reference graph:
// (1) a 2x export displayed as an <img> — the visual baseline e2e/png-export
// .spec.ts screenshots; (2) a real-browser seamless-tiling check — force
// tiny tiles, stitch them back onto one canvas at their own offsets, and
// compare that pixel-for-pixel against an untiled render at the same
// effective scale. Exact equality is the right bar here (not a tolerant
// diff): both renders draw the identical items through the identical paint
// code in the same browser, just windowed differently, so a real seam would
// show up as a byte difference, not noise.
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
    __seamless: boolean;
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

  window.__seamless =
    tiles.length > 1 && // the fixture is only proving something if tiling actually happened
    stitchedData.length === wholeData.length &&
    stitchedData.every((value, i) => value === wholeData[i]);
  window.__ready = true;
}

void main();
