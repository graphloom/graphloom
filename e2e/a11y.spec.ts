// Phase Gate G5 (a11y smoke, active from P3): axe over the demo page. The
// full keyboard-only suite lands with P11.
import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';

test('demo page has no serious or critical axe violations', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('[data-graphloom="svg"]')).toBeVisible();
  const results = await new AxeBuilder({ page }).analyze();
  const blocking = results.violations.filter((violation) =>
    ['serious', 'critical'].includes(violation.impact ?? ''),
  );
  expect(
    blocking.map((violation) => `${violation.id}: ${violation.description}`),
  ).toEqual([]);
});
