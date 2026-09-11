// P10-T03 close-out.
import { expect, test } from '@playwright/test';

test('Export SVG opens a standalone document in a plain tab (real consumer)', async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.getByTestId('nodes')).toHaveText('3');

  const [popup] = await Promise.all([
    page.waitForEvent('popup'),
    page.getByTestId('export-svg').click(),
  ]);
  await popup.waitForLoadState();

  // A real, standalone SVG document: root element present, the demo's node
  // labels rendered, and — proving it carries zero app chrome — none of the
  // editor page's own UI text reached this tab.
  await expect(popup.locator('svg')).toBeVisible();
  const html = await popup.content();
  expect(html).toContain('Alpha');
  expect(html).toContain('Beta');
  expect(html).toContain('Gamma');
  expect(html).not.toContain('GraphLoom editor');
});

test('exported SVG renders identically to the Canvas view of the same graph (visual check)', async ({
  page,
}) => {
  await page.goto('/svg-export.html?mode=canvas');
  await page.waitForFunction(() => window.__ready === true);
  await expect(page.locator('#stage')).toHaveScreenshot('svg-export-parity.png');

  await page.goto('/svg-export.html?mode=export');
  await page.waitForFunction(() => window.__ready === true);
  // SVG <text> vs canvas fillText / AA on the rounded node corners differ by
  // fractions of a pixel — same tolerance and rationale as the P9-T02 parity
  // check, which this mirrors for the export path instead of the live SVG
  // renderer.
  await expect(page.locator('#stage')).toHaveScreenshot('svg-export-parity.png', {
    maxDiffPixelRatio: 0.03,
  });
});
