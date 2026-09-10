// P9-T03 benchmark harness. Drives the synthetic-graph fixture
// (apps/examples/bench.html) headlessly and writes bench-results/metrics.json.
// It does NOT assert budgets — tools/bench-report.mjs owns the ADR-0007 gate
// and the <10%-variance harness-health check, so a regression still gets its
// trend point recorded before the job fails.
//
// "Frame time" here is the synchronous pipeline cost behind one interactive
// update (host.renderNow(): scene derive + cull + frame build + renderer
// mutation) — the JS work ADR-0007's <16ms budget actually governs. Real
// compositor time on a shared CI runner is too noisy to gate on.
import { mkdirSync, writeFileSync } from 'node:fs';
import { expect, test, type Page } from '@playwright/test';
import type { BenchResults } from '../apps/examples/src/bench.ts';

// Gated at the ADR-0007 defaults on both production backends; 5k/20k on Canvas
// is headroom-trend only (SVG at 20k edges is not a supported working set).
const CONFIGS = [
  { label: 'svg 500x2000', query: 'nodes=500&edges=2000' },
  { label: 'canvas 500x2000', query: 'nodes=500&edges=2000&renderer=canvas' },
  { label: 'canvas 5000x20000', query: 'nodes=5000&edges=20000&renderer=canvas' },
] as const;

const openFixture = async (page: Page, query: string): Promise<void> => {
  await page.goto(`/bench.html?${query}`);
  await page.waitForFunction(() => window.__bench?.ready === true, undefined, { timeout: 120_000 });
};

// workers:1 + fullyParallel:false (bench config) already runs these in order in
// one worker, so the module-level accumulator is safe. Not `mode: 'serial'` —
// a failure in one config shouldn't skip the rest (partial metrics.json still
// tells bench-report which run broke).
const metrics: Record<string, unknown> = {};

for (const { label, query } of CONFIGS) {
  test(`latency — ${label}`, async ({ page }) => {
    await openFixture(page, query);
    const results = await page.evaluate(() => window.__bench.run());
    metrics[label] = results satisfies BenchResults;
  });
}

/** GC then read the live JS heap over a CDP session (Chromium only). */
const measureHeapGrowth = async (
  page: Page,
  exercise: () => void | Promise<void>,
): Promise<{ beforeBytes: number; afterBytes: number; growthPct: number }> => {
  const cdp = await page.context().newCDPSession(page);
  const heapUsed = async (): Promise<number> => {
    await cdp.send('HeapProfiler.collectGarbage');
    const { usedSize } = (await cdp.send('Runtime.getHeapUsage')) as { usedSize: number };
    return usedSize;
  };
  const beforeBytes = await heapUsed();
  await exercise();
  const afterBytes = await heapUsed();
  return { beforeBytes, afterBytes, growthPct: ((afterBytes - beforeBytes) / beforeBytes) * 100 };
};

test('heap after churn — canvas 500x2000', async ({ page }) => {
  await openFixture(page, 'nodes=500&edges=2000&renderer=canvas');
  const r = await measureHeapGrowth(page, () => page.evaluate(() => window.__bench.churn(500)));
  metrics['heap'] = { churnCycles: 500, ...r };
  // Sanity only — the real flat-heap gate is bench-report.mjs.
  expect(r.growthPct).toBeLessThan(50);
});

// P9-T04 acceptance: editor create→use→destroy ×100 shows a flat heap. Runs on
// both backends — the SVG path is the one the acceptance names (detached-DOM
// accumulation), the Canvas path guards the P9-T01/T04 element/image caches.
for (const backend of ['svg', 'canvas'] as const) {
  test(`lifecycle heap — ${backend} 500x2000`, async ({ page }) => {
    const query = backend === 'canvas' ? 'nodes=500&edges=2000&renderer=canvas' : 'nodes=500&edges=2000';
    await openFixture(page, query);
    const r = await measureHeapGrowth(page, () => page.evaluate(() => window.__bench.lifecycle(100)));
    metrics[`lifecycle-${backend}`] = { iterations: 100, ...r };
    expect(r.growthPct).toBeLessThan(50);
  });
}

test.afterAll(() => {
  mkdirSync('bench-results', { recursive: true });
  writeFileSync('bench-results/metrics.json', `${JSON.stringify(metrics, null, 2)}\n`);
});
