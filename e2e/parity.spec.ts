// P9-T02: SVG↔Canvas renderer parity verification.
//
// Both backends consume the identical, renderer-agnostic SceneFrame
// (ADR-0002) and share path-data.ts for every shape's path string, so
// scene- and path-level geometry parity is structural — guaranteed by
// shared code, not something this test re-derives per shape. What runs on
// independent code in canvas.ts vs svg.ts is the *painting*: transform
// application, style resolution, text baseline/positioning, image
// placement, marker rotation. That is where a backend bug would hide, so
// this test screenshots the shape gallery (every built-in shape × visual
// state × theme, from gallery.ts) on each backend and diffs the two.
//
// ?parity=1 disables the P3-T09 background grid and the default
// unbound-edge arrowhead — SVG-only presentation extras, not part of the
// Renderer contract. Canvas parity for those is deferred to P9-T05 (the
// minimap needs a Canvas grid regardless). The Playwright HTML report
// (side-by-side + diff image on failure, uploaded as the CI e2e artifact)
// is the parity report.
import { expect, test } from '@playwright/test';

// SVG <text> vs canvas fillText, and AA on diagonal edges/curves, differ by
// fractions of a pixel across ~30 labels. 3% absorbs that noise floor; a
// geometry bug worth this task (wrong polygon, dropped rotation, bad
// transform) moves a 150×95px cell far past it.
const PARITY = { maxDiffPixelRatio: 0.03 } as const;

for (const theme of ['light', 'dark'] as const) {
  test(`SVG and Canvas paint the shape gallery identically (${theme})`, async ({ page }) => {
    const open = async (query: string, backend: 'svg' | 'canvas'): Promise<void> => {
      await page.goto(`/gallery.html?${query}`);
      await expect(page.locator(`[data-graphloom="${backend}"]`)).toBeVisible();
      if (theme === 'dark') {
        await page.getByTestId('theme-toggle').click();
        await expect(page.getByTestId('theme-name')).toHaveText('dark');
      }
    };

    // SVG is the reference — a normal strict visual baseline.
    await open('parity=1', 'svg');
    await expect(page).toHaveScreenshot(`gallery-parity-${theme}.png`);

    // Canvas must match that same baseline within the text/AA tolerance.
    // Any geometry mismatch exceeds it and fails.
    await open('parity=1&renderer=canvas', 'canvas');
    await expect(page).toHaveScreenshot(`gallery-parity-${theme}.png`, PARITY);
  });
}
