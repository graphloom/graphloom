import { expect, test } from '@playwright/test';

test('examples app boots', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#app')).toContainText('GraphLoom');
});
