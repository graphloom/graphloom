// P8 worker-execution follow-up: proves createWorkerEngine round-trips
// through a real Worker built by Vite (not just the in-process fake the
// package's own unit tests use). Model state only — no pixel baseline.
import { expect, test, type Page } from '@playwright/test';

const nodePosition = (page: Page, id: string): Promise<{ x: number; y: number } | undefined> =>
  page.evaluate((nodeId) => window.workerLayoutDemo.editor.graph.getNode(nodeId)?.position, id);

test.beforeEach(async ({ page }) => {
  await page.goto('/worker-layout.html');
  await expect(page.getByTestId('status')).toHaveText('idle');
});

test('runs a layout inside a real Worker and applies positions through the normal transaction path', async ({
  page,
}) => {
  const errors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(msg.text());
  });
  page.on('pageerror', (err) => errors.push(err.message));

  const before = await nodePosition(page, 'a');

  await page.getByTestId('run-force').click();
  await expect(page.getByTestId('status')).toHaveText('done');

  const after = await nodePosition(page, 'a');
  expect(after).not.toEqual(before);
  expect(errors).toEqual([]);
});

test('runs each built-in engine via the worker without error', async ({ page }) => {
  for (const testId of ['run-tree', 'run-layered', 'run-force']) {
    await page.getByTestId(testId).click();
    await expect(page.getByTestId('status')).toHaveText('done');
  }
});

test('every node moves off its seeded position — the whole graph was laid out, not just one node', async ({
  page,
}) => {
  await page.getByTestId('run-tree').click();
  await expect(page.getByTestId('status')).toHaveText('done');

  for (const id of ['a', 'b', 'c']) {
    expect(await nodePosition(page, id)).not.toEqual({ x: 0, y: 0 });
  }
});
