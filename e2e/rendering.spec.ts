// P3-T10 / Phase 3 exit criteria: a 100-node graph renders; programmatic
// pan/zoom/zoom-to-fit work; hit testing answers correctly at any zoom.
import { expect, test, type Page } from '@playwright/test';

const worldTransform = (page: Page): Promise<string | null> =>
  page.locator('[data-layer="world"]').getAttribute('transform');

test.beforeEach(async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible();
});

test('renders the 100-node demo graph', async ({ page }) => {
  // Zoom-to-fit on load puts every node in view; virtualization means the
  // DOM count equals the visible count — here, all of them.
  await expect(page.locator('[data-layer="nodes"] rect, [data-layer="nodes"] ellipse')).toHaveCount(
    100,
  );
  await expect(page.locator('[data-layer="edges"] path')).toHaveCount(126);
  await expect(page.getByTestId('zoom')).not.toHaveText('');
});

test('programmatic pan, zoom, and zoom-to-fit', async ({ page }) => {
  const initial = await worldTransform(page);

  await page.getByRole('button', { name: 'Zoom in' }).click();
  const zoomedIn = Number(await page.getByTestId('zoom').textContent());
  await page.getByRole('button', { name: 'Zoom out' }).click();
  const zoomedOut = Number(await page.getByTestId('zoom').textContent());
  expect(zoomedOut).toBeLessThan(zoomedIn);

  // Programmatic pan through the public host handle.
  await page.evaluate(() => window.graphloom.viewport.panBy(123, -45));
  await page.waitForFunction(
    (before) =>
      document.querySelector('[data-layer="world"]')?.getAttribute('transform') !== before,
    initial,
  );

  // Zoom-to-fit restores the initial fitted transform exactly.
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await page.waitForFunction(
    (before) =>
      document.querySelector('[data-layer="world"]')?.getAttribute('transform') === before,
    initial,
  );
});

test('hit testing answers correctly at any zoom', async ({ page }) => {
  const clickNode = async (id: string): Promise<string> => {
    // Off-center: the label <text> sits over the node center and would
    // intercept Playwright's actionability check (picking itself is core-side).
    await page.locator(`[data-item="${id}"]`).click({ position: { x: 8, y: 8 } });
    return (await page.getByTestId('hit').textContent()) ?? '';
  };

  expect(await clickNode('node:n55')).toContain('node:n55');

  // Empty canvas corner misses.
  await page.getByTestId('canvas').click({ position: { x: 5, y: 5 } });
  await expect(page.getByTestId('hit')).toHaveText('—');

  // Same node still hits after zooming in twice (world-space picking).
  await page.getByRole('button', { name: 'Zoom in' }).click();
  await page.getByRole('button', { name: 'Zoom in' }).click();
  expect(await clickNode('node:n55')).toContain('node:n55');
});

test('visual baseline: fitted 100-node graph', async ({ page }) => {
  // Deterministic state: fit + fixed viewport size from playwright config.
  await page.getByRole('button', { name: 'Zoom to fit' }).click();
  await expect(page).toHaveScreenshot('graph-demo-fit.png');
});
