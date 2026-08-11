// P9-T01 close-out: the Canvas 2D renderer's real-browser proof. The
// conformance suite (canvas.test.ts) can't paint in jsdom — no 2D context —
// so this is the first place the paint dispatch runs for real, and the
// acceptance criterion itself ("swap SVG↔Canvas mid-session lossless")
// is inherently a browser-level claim: model, selection, and history live
// above the Renderer contract (ADR-0002) and must survive a backend swap
// untouched.
import { expect, test, type Page } from '@playwright/test';

/**
 * A point near the node's top-left corner, from the live scene
 * (renderer-agnostic). Off-center: the label sits over the node's exact
 * center and would intercept the hit (same convention as rendering.spec.ts's
 * hit-test case — picking itself is core-side, not a DOM event target).
 */
const screenCorner = async (page: Page, id: string): Promise<{ x: number; y: number }> => {
  const world = await page.evaluate((nodeId) => {
    const item = window.editorDemo.host.scene.get(`node:${nodeId}`);
    const b = (item as { bounds: { x: number; y: number } }).bounds;
    return { x: b.x + 8, y: b.y + 8 };
  }, id);
  const screen = await page.evaluate((w) => window.editorDemo.host.viewport.worldToScreen(w), world);
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return { x: box.x + screen.x, y: box.y + screen.y };
};

const selectedIds = (page: Page): Promise<string[]> =>
  page.evaluate(() => window.editorDemo.engine.selection.nodeIds());

test.beforeEach(async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.getByTestId('nodes')).toHaveText('3');
});

test('swap SVG→Canvas mid-session is lossless: selection, hit testing, and interaction survive', async ({
  page,
}) => {
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible();

  // Off-center: the label <text> sits over the node center (same convention
  // as rendering.spec.ts's hit-test case).
  await page.locator('[data-item="node:alpha"]').click({ position: { x: 8, y: 8 } });
  await expect(page.getByTestId('selected')).toHaveText('1');
  expect(await selectedIds(page)).toEqual(['alpha']);

  await page.getByTestId('renderer').selectOption('canvas');
  await expect(page.locator('[data-graphloom="canvas"]')).toBeVisible();
  await expect(page.locator('[data-graphloom="svg"]')).toHaveCount(0);

  // The swap touches nothing above the Renderer contract — selection is untouched.
  await expect(page.getByTestId('selected')).toHaveText('1');
  expect(await selectedIds(page)).toEqual(['alpha']);

  // The new backend's own hitTest() answers correctly (not just the
  // interaction engine's renderer-agnostic spatial index).
  const gammaScreen = await screenCorner(page, 'gamma');
  const box = (await page.getByTestId('canvas').boundingBox())!;
  const hit = await page.evaluate(
    (p) => window.editorDemo.host.renderer.hitTest(p),
    { x: gammaScreen.x - box.x, y: gammaScreen.y - box.y },
  );
  expect(hit).toBe('node:gamma');

  // A real pointer click through the whole interaction stack still selects.
  await page.mouse.click(gammaScreen.x, gammaScreen.y);
  await expect(page.getByTestId('selected')).toHaveText('1');
  expect(await selectedIds(page)).toEqual(['gamma']);

  // Round trip: swapping back to SVG is equally lossless.
  await page.getByTestId('renderer').selectOption('svg');
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible();
  await expect(page.locator('[data-graphloom="canvas"]')).toHaveCount(0);
  expect(await selectedIds(page)).toEqual(['gamma']);
  await expect(page.getByTestId('can-undo')).toHaveText('no'); // no history entries from any of this
});

test('visual baseline: Canvas backend paints the demo graph', async ({ page }) => {
  await page.getByTestId('renderer').selectOption('canvas');
  await expect(page.locator('[data-graphloom="canvas"]')).toBeVisible();
  await expect(page).toHaveScreenshot('editor-canvas.png');
});
