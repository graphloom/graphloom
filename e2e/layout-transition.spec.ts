// P8-T06 close-out: proves the core clock (SceneGraph position overrides +
// createLayoutTransition) through a real browser — a real rAF-driven ease,
// and a real drag gesture grabbing a node while it's still mid-transition.
import { expect, test, type Page } from '@playwright/test';

const nodePosition = (page: Page, id: string): Promise<{ x: number; y: number } | undefined> =>
  page.evaluate((nodeId) => window.editorDemo.editor.graph.getNode(nodeId)?.position, id);

const hasOverride = (page: Page, id: string): Promise<boolean> =>
  page.evaluate((nodeId) => window.editorDemo.host.scene.hasPositionOverride(nodeId), id);

/** The node's current *rendered* (possibly still-easing) screen point. */
const currentScreenPoint = async (page: Page, id: string): Promise<{ x: number; y: number }> => {
  const world = await page.evaluate((nodeId) => {
    const item = window.editorDemo.host.scene.get(`node:${nodeId}`);
    const b = (item as { bounds: { x: number; y: number; width: number; height: number } }).bounds;
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  }, id);
  const screen = await page.evaluate(
    (w) => window.editorDemo.host.viewport.worldToScreen(w),
    world,
  );
  const box = (await page.getByTestId('canvas').boundingBox())!;
  return { x: box.x + screen.x, y: box.y + screen.y };
};

test.beforeEach(async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.getByTestId('transitioning')).toHaveText('no');
});

test('running a layout commits final positions immediately, then eases visually', async ({ page }) => {
  const before = await nodePosition(page, 'alpha');

  await page.getByTestId('run-layout').click();
  // The layout run's own transaction lands before the transition even starts
  // (runLayout awaits layoutRunner.run() first) — one undo restores the seed.
  await expect(page.getByTestId('can-undo')).toHaveText('yes');
  const settledDuringEase = await nodePosition(page, 'alpha');
  expect(settledDuringEase).not.toEqual(before); // model already final, mid-ease or not

  await expect(page.getByTestId('transitioning')).toHaveText('yes');
  await expect(page.getByTestId('transitioning')).toHaveText('no', { timeout: 5000 });

  const after = await nodePosition(page, 'alpha');
  expect(after).toEqual(settledDuringEase); // the ease never touched the model
  expect(await hasOverride(page, 'alpha')).toBe(false); // override cleared on natural settle

  const undone = await page.evaluate(() => window.editorDemo.history.undo());
  expect(undone).toBe(true);
  expect(await nodePosition(page, 'alpha')).toEqual(before); // one entry: layout run only
});

test('a drag grabbing a still-transitioning node hands off cleanly', async ({ page }) => {
  await page.getByTestId('run-layout').click();
  await expect(page.getByTestId('transitioning')).toHaveText('yes');
  expect(await hasOverride(page, 'alpha')).toBe(true); // mid-ease, as expected

  const grab = await currentScreenPoint(page, 'alpha');
  await page.mouse.move(grab.x, grab.y);
  await page.mouse.down();
  // drag.begin fires synchronously inside the pointerdown handler — the
  // transition hands off immediately, before any move. Polled (not a bare
  // assertion) since it's checking page state right after an input event.
  await expect.poll(() => hasOverride(page, 'alpha')).toBe(false);

  await page.mouse.move(grab.x + 60, grab.y + 40, { steps: 5 });
  await page.mouse.up();

  const after = await nodePosition(page, 'alpha');
  expect(after).not.toBeUndefined();
  expect(await hasOverride(page, 'alpha')).toBe(false); // stayed clear through the whole gesture

  // The rest of the batch (beta, gamma) wasn't touched by the hand-off —
  // the transition keeps going and still settles naturally.
  await expect(page.getByTestId('transitioning')).toHaveText('no', { timeout: 5000 });
  expect(await hasOverride(page, 'beta')).toBe(false);
  expect(await hasOverride(page, 'gamma')).toBe(false);
});
