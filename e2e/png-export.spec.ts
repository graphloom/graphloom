// P10-T04 close-out.
import { readFileSync } from 'node:fs';
import { expect, test } from '@playwright/test';

const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

test('Export PNG downloads a real PNG of the current graph (real consumer)', async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.getByTestId('nodes')).toHaveText('3');

  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByTestId('export-png').click(),
  ]);
  expect(download.suggestedFilename()).toBe('graph.png');
  const path = await download.path();
  const bytes = readFileSync(path!);
  expect(bytes.subarray(0, 8)).toEqual(PNG_MAGIC);
  expect(bytes.length).toBeGreaterThan(100); // not an empty/corrupt file
});

test('2x export of the reference graph matches the baseline (visual check)', async ({ page }) => {
  await page.goto('/png-export.html');
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator('#baseline')).toHaveScreenshot('png-export-2x.png');
});

test('tiling a graph past maxTileSize reproduces the untiled render with no seams', async ({ page }) => {
  await page.goto('/png-export.html');
  await page.waitForFunction(() => window.__ready === true);
  // Real-browser proof, not a screenshot diff: stitching the tiles back
  // together at their own offsets and comparing raw pixel bytes against an
  // untiled render of the same graph at the same scale is an exact bar (both
  // renders draw identical items through identical paint code, just
  // windowed differently — a real seam is a byte diff, not AA noise).
  expect(await page.evaluate(() => window.__seamless)).toBe(true);
});
