// P7 close-out / phase exit criteria: every spec §Shape Library shape renders
// on SVG (visual baseline per theme) and dark/light themes switch live.
import { expect, test } from '@playwright/test';

const SHAPES = [
  'rectangle',
  'rounded-rectangle',
  'circle',
  'diamond',
  'triangle',
  'hexagon',
  'database',
  'queue',
  'cloud',
  'folder',
  'document',
  'person',
  'server',
  'api',
  'storage',
  'container',
  'image',
  'svg',
  'icon',
];

test.beforeEach(async ({ page }) => {
  await page.goto('/gallery.html');
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible();
  await expect(page.getByTestId('theme-name')).toHaveText('light');
});

test('every built-in shape renders on the SVG backend', async ({ page }) => {
  for (const type of SHAPES) {
    await expect(
      page.locator(`[data-item="node:s-${type}"]`),
      type,
    ).toHaveCount(1);
  }
  // Markers, fanned parallels, self-loop, always-ports, group badge.
  await expect(page.locator('[data-item="marker:edge:e-straight:end"]')).toHaveCount(1);
  await expect(page.locator('[data-item="marker:edge:e-loop:end"]')).toHaveCount(1);
  await expect(page.locator('[data-item^="edge:fan-"]')).toHaveCount(3);
  await expect(page.locator('[data-item="port:node:s-triangle:left"]')).toHaveCount(1);
  await expect(page.locator('[data-item="badge:group:grp:count"]')).toHaveText('2');
  // The hovered state node exposes its hover-visibility port.
  await expect(page.locator('[data-item="port:node:state-hovered:p"]')).toHaveCount(1);
});

test('dark/light themes switch live without touching the model', async ({ page }) => {
  // Repaints land on the next animation frame — always use the retrying
  // attribute assertion, never a one-shot read (CI-found race).
  const rectangle = page.locator('[data-item="node:s-rectangle"]');
  await expect(rectangle).toHaveAttribute('fill', '#e8eefc'); // pinned light token

  // Count model commits across the toggles — theme switching must emit none.
  await page.evaluate(() => {
    (window as unknown as { changeCount: number }).changeCount = 0;
    window.gallery.editor.on('graph.change', () => {
      (window as unknown as { changeCount: number }).changeCount += 1;
    });
  });

  await page.getByTestId('theme-toggle').click();
  await expect(page.getByTestId('theme-name')).toHaveText('dark');
  await expect(rectangle).toHaveAttribute('fill', '#1e2a4a'); // dark token

  await page.getByTestId('theme-toggle').click();
  await expect(page.getByTestId('theme-name')).toHaveText('light');
  await expect(rectangle).toHaveAttribute('fill', '#e8eefc'); // exact round-trip
  expect(
    await page.evaluate(() => (window as unknown as { changeCount: number }).changeCount),
  ).toBe(0); // no model events in history (P7-T07 acceptance, in a real browser)
});

test('visual baseline: gallery, light theme', async ({ page }) => {
  await expect(page).toHaveScreenshot('gallery-light.png');
});

test('visual baseline: gallery, dark theme', async ({ page }) => {
  await page.getByTestId('theme-toggle').click();
  await expect(page.getByTestId('theme-name')).toHaveText('dark');
  await expect(page).toHaveScreenshot('gallery-dark.png');
});
