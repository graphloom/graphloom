// P4-T11: the Phase 4 exit scenario in real browsers. Every committing
// gesture is followed by an undo assertion (tracker acceptance). Selection
// and marquee are UI state by design (P4-T03) and have no undo.
//
// Demo geometry (viewport starts at identity, so world == canvas px):
//   alpha (120,160) 120×48  ports: in (120,184) out (240,184)
//   beta  (420,160) 120×48  ports: in (420,184) out (540,184)
//   gamma (270,340) 120×48  ports: in (270,364) out (390,364)
//   edge ab: alpha.out → beta.in
import { expect, test, type Page } from '@playwright/test';

/** Canvas-relative → page coordinates. */
const canvasPoint = async (page: Page, x: number, y: number): Promise<{ x: number; y: number }> => {
  const box = (await page.getByTestId('canvas').boundingBox())!;
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
  page.evaluate((nodeId) => window.editorDemo.editor.graph.getNode(nodeId)?.position, id);

test.beforeEach(async ({ page }) => {
  await page.goto('/editor.html');
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible();
  await expect(page.getByTestId('nodes')).toHaveText('3');
});

test('double-click creates a node; undo removes it', async ({ page }) => {
  await page.getByTestId('canvas').dblclick({ position: { x: 700, y: 450 } });
  await expect(page.getByTestId('nodes')).toHaveText('4');
  await expect(page.getByTestId('can-undo')).toHaveText('yes');
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('click select, shift-click toggle, escape clears', async ({ page }) => {
  await page.getByTestId('canvas').click({ position: { x: 180, y: 184 } }); // alpha
  await expect(page.getByTestId('selected')).toHaveText('1');
  await page.getByTestId('canvas').click({ position: { x: 480, y: 184 }, modifiers: ['Shift'] });
  await expect(page.getByTestId('selected')).toHaveText('2');
  await page.getByTestId('canvas').click({ position: { x: 480, y: 184 }, modifiers: ['Shift'] });
  await expect(page.getByTestId('selected')).toHaveText('1');
  await page.keyboard.press('Escape');
  await expect(page.getByTestId('selected')).toHaveText('0');
});

test('marquee selects intersecting elements at any zoom', async ({ page }) => {
  await drag(page, [40, 80], [620, 280]); // covers alpha, beta, edge ab — not gamma
  await expect(page.getByTestId('selected')).toHaveText('3');
  const ids = await page.evaluate(() => [...window.editorDemo.engine.selection.ids()].sort());
  expect(ids).toEqual(['ab', 'alpha', 'beta']);
});

test('node drag commits one undoable move', async ({ page }) => {
  await drag(page, [180, 184], [230, 234]); // alpha body +50/+50
  const moved = await nodePosition(page, 'alpha');
  expect(moved).not.toEqual({ x: 120, y: 160 });
  await page.keyboard.press('ControlOrMeta+z'); // ONE undo restores the gesture
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 });
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('snapping: a tiny drag inside the snap radius commits nothing', async ({ page }) => {
  // +6/+6: every edge/center line of alpha snaps back to its own origin
  // lines (all within the 8 px radius, and nothing else is closer).
  await drag(page, [180, 184], [186, 190]);
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 });
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('drag from port connects with magnetic snap; undo removes the edge', async ({ page }) => {
  await drag(page, [540, 184], [272, 362]); // beta.out → near gamma.in
  await expect(page.getByTestId('edges')).toHaveText('2');
  const edge = await page.evaluate(() =>
    window.editorDemo.editor.graph.edges().find((e) => e.id !== 'ab'),
  );
  expect(edge).toMatchObject({ source: 'beta', sourcePort: 'out', target: 'gamma', targetPort: 'in' });
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('edges')).toHaveText('1');
});

test('drop on empty canvas cancels the connection', async ({ page }) => {
  await drag(page, [540, 184], [700, 450]);
  await expect(page.getByTestId('edges')).toHaveText('1');
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('resize via SE handle; undo restores size', async ({ page }) => {
  await page.getByTestId('canvas').click({ position: { x: 180, y: 184 } }); // select alpha
  await expect(page.locator('[data-handle="se"]')).toHaveCount(1);
  await drag(page, [240, 208], [280, 238]); // SE corner +40/+30
  await page.waitForFunction(
    () => window.editorDemo.editor.graph.getNode('alpha')?.size.width === 160,
  );
  const size = await page.evaluate(() => window.editorDemo.editor.graph.getNode('alpha')?.size);
  expect(size).toEqual({ width: 160, height: 78 });
  await page.keyboard.press('ControlOrMeta+z');
  expect(await page.evaluate(() => window.editorDemo.editor.graph.getNode('alpha')?.size)).toEqual({
    width: 120,
    height: 48,
  });
});

test('arrow nudge is one history entry per press', async ({ page }) => {
  await page.getByTestId('canvas').click({ position: { x: 180, y: 184 } });
  await page.keyboard.press('ArrowRight');
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 121, y: 160 });
  await page.keyboard.press('Shift+ArrowRight');
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 131, y: 160 });
  await page.keyboard.press('ControlOrMeta+z');
  await page.keyboard.press('ControlOrMeta+z');
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 });
});

test('copy/paste is one undoable transaction; ctrl+A selects all', async ({ page }) => {
  await page.getByTestId('canvas').click({ position: { x: 180, y: 184 } });
  await page.keyboard.press('ControlOrMeta+c');
  await page.keyboard.press('ControlOrMeta+v');
  await expect(page.getByTestId('nodes')).toHaveText('4');
  await expect(page.getByTestId('selected')).toHaveText('1'); // pasted node selected
  await page.keyboard.press('ControlOrMeta+z');
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await page.keyboard.press('ControlOrMeta+a');
  await expect(page.getByTestId('selected')).toHaveText('4'); // 3 nodes + 1 edge
});

test('context menu deletes a node (cascade) and undo restores both', async ({ page }) => {
  await page.getByTestId('canvas').click({ position: { x: 180, y: 184 }, button: 'right' });
  await expect(page.getByTestId('menu')).toBeVisible();
  await page.getByTestId('menu').getByRole('button', { name: 'Delete' }).click();
  await expect(page.getByTestId('nodes')).toHaveText('2');
  await expect(page.getByTestId('edges')).toHaveText('0'); // ab cascaded
  await page.keyboard.press('ControlOrMeta+z'); // one entry restores node + edge
  await expect(page.getByTestId('nodes')).toHaveText('3');
  await expect(page.getByTestId('edges')).toHaveText('1');
});

test('wheel zooms about the cursor; space+drag pans; model untouched', async ({ page }) => {
  const center = await canvasPoint(page, 400, 300);
  await page.mouse.move(center.x, center.y);
  await page.mouse.wheel(0, -100);
  await page.waitForFunction(() => window.editorDemo.host.viewport.viewport.zoom > 1);

  const before = await page.evaluate(() => window.editorDemo.host.viewport.viewport);
  await page.keyboard.down(' ');
  await drag(page, [400, 300], [460, 320]);
  await page.keyboard.up(' ');
  const after = await page.evaluate(() => window.editorDemo.host.viewport.viewport);
  expect(after.x - before.x).toBeCloseTo(60, 0);
  expect(after.y - before.y).toBeCloseTo(20, 0);
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 }); // pan is not an edit
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test('escape aborts a drag mid-gesture with zero model change', async ({ page }) => {
  const a = await canvasPoint(page, 180, 184);
  const b = await canvasPoint(page, 300, 300);
  await page.mouse.move(a.x, a.y);
  await page.mouse.down();
  await page.mouse.move(b.x, b.y, { steps: 5 });
  await page.keyboard.press('Escape');
  await page.mouse.up();
  expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 });
  await expect(page.getByTestId('can-undo')).toHaveText('no');
});

test.describe('touch', () => {
  test.use({ hasTouch: true });

  test('tap selects a node', async ({ page }) => {
    await page.getByTestId('canvas').tap({ position: { x: 180, y: 184 } });
    await expect(page.getByTestId('selected')).toHaveText('1');
  });

  /**
   * Touch drags/long-presses are driven as touch-typed pointer events on the
   * canvas: identical adapter+engine path in every browser, no CDP. Native
   * browser touch synthesis itself is covered by the `tap` test above.
   */
  const touchSequence = (
    page: Page,
    points: readonly { x: number; y: number }[],
    holdMs: number,
  ): Promise<void> =>
    page.evaluate(
      async ({ points, holdMs }) => {
        const canvas = document.querySelector('[data-testid="canvas"]')!;
        const box = canvas.getBoundingClientRect();
        const fire = (type: string, p: { x: number; y: number }): void => {
          const e = new PointerEvent(type, {
            bubbles: true,
            pointerId: 7,
            pointerType: 'touch',
            clientX: box.left + p.x,
            clientY: box.top + p.y,
            button: 0,
          });
          canvas.dispatchEvent(e);
        };
        fire('pointerdown', points[0]!);
        if (holdMs > 0) await new Promise((r) => setTimeout(r, holdMs));
        for (const p of points.slice(1)) fire('pointermove', p);
        fire('pointerup', points.at(-1)!);
      },
      { points, holdMs },
    );

  test('touch drag moves a node; undo restores', async ({ page }) => {
    await touchSequence(
      page,
      [0, 1, 2, 3, 4, 5, 6].map((i) => ({ x: 180 + i * 10, y: 184 + i * 10 })),
      0,
    );
    await page.waitForFunction(
      () => window.editorDemo.editor.graph.getNode('alpha')?.position.x !== 120,
    );
    await page.keyboard.press('ControlOrMeta+z');
    expect(await nodePosition(page, 'alpha')).toEqual({ x: 120, y: 160 });
  });

  test('touch long-press opens the context menu', async ({ page }) => {
    await touchSequence(page, [{ x: 180, y: 184 }], 700); // past the 500 ms threshold
    await expect(page.getByTestId('menu')).toBeVisible();
  });
});
