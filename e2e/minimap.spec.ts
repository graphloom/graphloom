// P9-T05 close-out: the minimap plugin driven through the editor demo — a
// real second Canvas renderer over the shared scene. Model state + DOM only,
// no pixel baseline (same as worker-layout).
import { expect, test, type Page } from '@playwright/test';

const plugins = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.editorDemo.editor.plugins() as string[]);

const viewport = (page: Page): Promise<{ x: number; y: number; zoom: number }> =>
  page.evaluate(() => window.editorDemo.host.viewport.viewport);

const indicatorRect = (page: Page): Promise<{ left: number; top: number; width: number }> =>
  page.evaluate(() => {
    const el = document.querySelector<HTMLElement>('#minimap [data-graphloom="minimap-indicator"]')!;
    return {
      left: parseFloat(el.style.left),
      top: parseFloat(el.style.top),
      width: parseFloat(el.style.width),
    };
  });

test.beforeEach(async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.getByTestId('nodes')).toHaveText('3');
});

test('installs and uninstalls as a plugin via the toggle', async ({ page }) => {
  expect(await plugins(page)).toContain('minimap');
  await expect(page.locator('#minimap canvas')).toBeVisible();

  await page.getByTestId('minimap-toggle').uncheck();
  expect(await plugins(page)).not.toContain('minimap');
  await expect(page.locator('#minimap canvas')).toHaveCount(0);

  await page.getByTestId('minimap-toggle').check();
  expect(await plugins(page)).toContain('minimap');
  await expect(page.locator('#minimap canvas')).toBeVisible();
});

test('dragging on the minimap pans the main view (pan only, directional)', async ({ page }) => {
  const box = (await page.getByTestId('minimap').boundingBox())!;
  const dragTo = async (fx: number, fy: number): Promise<void> => {
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * fx, box.y + box.height * fy, { steps: 10 });
    await page.mouse.up();
  };

  const start = await viewport(page);
  await dragTo(0.85, 0.85);
  const bottomRight = await viewport(page);
  await dragTo(0.15, 0.15);
  const topLeft = await viewport(page);

  // Zoom never changes — navigation is pan only.
  expect(bottomRight.zoom).toBe(start.zoom);
  expect(topLeft.zoom).toBe(start.zoom);
  // Each drag moved the view a meaningful distance...
  expect(Math.hypot(bottomRight.x - start.x, bottomRight.y - start.y)).toBeGreaterThan(50);
  // ...and toward opposite corners of the graph (translation shifts the other way).
  expect(topLeft.x).toBeGreaterThan(bottomRight.x);
  expect(topLeft.y).toBeGreaterThan(bottomRight.y);
});

test('reflects a viewport change within one frame', async ({ page }) => {
  const before = await indicatorRect(page);
  await page.evaluate(() => window.editorDemo.host.viewport.panBy(220, 160));
  const after = await indicatorRect(page);
  expect(after.left).not.toBeCloseTo(before.left, 1);
  expect(after.top).not.toBeCloseTo(before.top, 1);
});

test('reflects a model change within one frame', async ({ page }) => {
  const before = await indicatorRect(page);
  // Double-click a clear spot near the top-right (away from the bottom-right
  // minimap) adds a node, growing the graph bounds → the minimap re-fits.
  const canvas = (await page.getByTestId('canvas').boundingBox())!;
  await page.mouse.dblclick(canvas.x + canvas.width - 60, canvas.y + 40);
  await expect(page.getByTestId('nodes')).toHaveText('4');

  const after = await indicatorRect(page);
  // A larger fit ⇒ the same viewport rect maps to a smaller indicator.
  expect(after.width).toBeLessThan(before.width);
});
