// P6 close-out: the React demo (apps/examples-react) in real browsers. The
// served page is SSR-prerendered output and the app runs under StrictMode —
// hydration and the double-invoke lifecycle are exercised on every test's
// goto. Committing gestures carry an undo assertion (P4 convention).
//
// Demo geometry (identity viewport ⇒ world == canvas px):
//   alpha (120,160) 120×48  ports: in (120,184) out (240,184)
//   beta  (420,160) 120×48  ports: in (420,184) out (540,184)
//   gamma (270,340) 120×48  ports: in (270,364) out (390,364)  type 'card' (Tier-2 overlay)
//   edge ab: alpha.out → beta.in
import { expect, test, type Page } from '@playwright/test';

const URL = 'http://localhost:4302/';

const canvasPoint = async (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => {
  const box = (await page.getByTestId('graph').boundingBox())!;
  return { x: box.x + x, y: box.y + y };
};

const drag = async (
  page: Page,
  from: [number, number],
  to: [number, number],
  steps = 8,
): Promise<void> => {
  const a = await canvasPoint(page, ...from);
  const b = await canvasPoint(page, ...to);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps });
  await page.mouse.up();
};

const nodePosition = (page: Page, id: string): Promise<{ x: number; y: number } | undefined> =>
  page.evaluate((nodeId) => window.reactDemo.editor.graph.getNode(nodeId)?.position, id);

test.beforeEach(async ({ page }) => {
  await page.goto(URL);
  await expect(page.getByTestId('nodes')).toHaveText('3'); // hydrated + editor live
});

test('SSR + hydration: server HTML is real; StrictMode run is warning-free', async ({ page }) => {
  const problems: string[] = [];
  page.on('console', (message) => {
    if (message.type() === 'error' || message.type() === 'warning') problems.push(message.text());
  });
  page.on('pageerror', (error) => problems.push(String(error)));

  // page.goto's response can be a redirect (Firefox: body unavailable) —
  // fetch the wire HTML through the request context, which follows redirects.
  const raw = (await (await page.request.get(URL)).text()).toLowerCase();
  await page.goto(URL);
  expect(raw).toContain('data-graphloom-canvas'); // server-rendered host…
  expect(raw).toContain('graphloom react editor'); // …with the real app markup
  expect(raw).not.toContain('<svg'); // and no renderer output on the server

  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible(); // client attached
  // Phase exit criterion: the StrictMode demo produces ZERO warnings.
  expect(problems).toEqual([]);
});

test('double-click creates a node; undo removes it', async ({ page }) => {
  await page.getByTestId('graph').dblclick({ position: { x: 700, y: 450 } });
  await expect(page.getByTestId('nodes')).toHaveText('4');
  await expect(page.getByTestId('can-undo')).toHaveText('yes');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('tap selects; drag snaps and moves; one undo restores', async ({ page }) => {
  await page.getByTestId('graph').click({ position: { x: 180, y: 184 } }); // alpha body
  await expect(page.getByTestId('selected')).toHaveText('1');
  await drag(page, [180, 184], [243, 219]); // raw offset (63,35)
  const moved = await nodePosition(page, 'alpha');
  expect(moved).not.toEqual({ x: 120, y: 160 });
  await expect(page.getByTestId('can-undo')).toHaveText('yes');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 });
});

test('port drag connects gamma → beta; undo removes the edge', async ({ page }) => {
  await drag(page, [390, 364], [422, 182]); // gamma.out → beta.in
  await expect(page.getByTestId('edges')).toHaveText('2');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('edges')).toHaveText('1');
});

test('delete key removes selection (edge cascades); undo restores both', async ({ page }) => {
  await page.getByTestId('graph').click({ position: { x: 180, y: 184 } }); // alpha
  await page.keyboard.press('Delete');
  await expect(page.getByTestId('nodes')).toHaveText('2');
  await expect(page.getByTestId('edges')).toHaveText('0'); // ab cascaded
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.getByTestId('edges')).toHaveText('1');
});

test('copy/paste through the wrapper clipboard; one undo entry', async ({ page }) => {
  await page.getByTestId('graph').click({ position: { x: 180, y: 184 } }); // alpha
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByTestId('nodes')).toHaveText('4');
  await expect(page.getByTestId('selected')).toHaveText('1'); // pasted node selected
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('nodes')).toHaveText('3');
});

test('context menu deletes a node; undo restores', async ({ page }) => {
  await page.getByTestId('graph').click({ position: { x: 180, y: 184 }, button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('menu-delete').click();
  await expect(page.getByTestId('menu')).toBeHidden();
  await expect(page.getByTestId('nodes')).toHaveText('2');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('nodes')).toHaveText('3');
});

test('wheel zooms, space+drag pans; the model is untouched', async ({ page }) => {
  const at = await canvasPoint(page, 300, 200);
  await page.mouse.move(at.x, at.y);
  await page.mouse.wheel(0, -240);
  await expect
    .poll(() => page.evaluate(() => window.reactDemo.host.viewport.viewport.zoom))
    .toBeGreaterThan(1);
  await page.keyboard.down(' ');
  await drag(page, [300, 300], [360, 330]);
  await page.keyboard.up(' ');
  const viewport = await page.evaluate(() => window.reactDemo.host.viewport.viewport);
  expect(viewport.x).not.toBe(0);
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('Tier-2 overlay stays pixel-locked to the canvas across pan/zoom', async ({ page }) => {
  const overlay = page.locator('[data-graphloom-overlay] [data-node-id="gamma"]');
  await expect(overlay).toBeVisible();
  const graphBox = (await page.getByTestId('graph').boundingBox())!;

  for (const viewport of [
    { x: 0, y: 0, zoom: 1 },
    { x: 40, y: 10, zoom: 1.5 },
    { x: -35, y: 25, zoom: 0.75 },
  ]) {
    await page.evaluate((v) => window.reactDemo.host.viewport.setViewport(v), viewport);
    await page.evaluate(() => window.reactDemo.host.renderNow());
    // Core math is the contract: overlay box ≡ worldToScreen(node) at zoom.
    const screen = await page.evaluate(() =>
      window.reactDemo.host.viewport.worldToScreen({ x: 270, y: 340 }),
    );
    const overlayBox = (await overlay.boundingBox())!;
    expect(Math.abs(overlayBox.x - (graphBox.x + screen.x))).toBeLessThan(1);
    expect(Math.abs(overlayBox.y - (graphBox.y + screen.y))).toBeLessThan(1);
    expect(Math.abs(overlayBox.width - 120 * viewport.zoom)).toBeLessThan(1);
    expect(Math.abs(overlayBox.height - 48 * viewport.zoom)).toBeLessThan(1);
  }

  // Deterministic state for the visual baseline (acceptance: e2e screenshot).
  await page.evaluate(() => window.reactDemo.host.viewport.setViewport({ x: 40, y: 10, zoom: 1.5 }));
  await page.evaluate(() => window.reactDemo.host.renderNow());
  await expect(page).toHaveScreenshot('react-editor-overlay.png');
});
