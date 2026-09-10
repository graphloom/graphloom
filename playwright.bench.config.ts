import { defineConfig, devices } from '@playwright/test';

// P9-T03 benchmark harness — separate from the e2e config so `pnpm e2e` stays
// fast and deterministic. Chromium only: the heap metric drives CDP
// (`HeapProfiler.collectGarbage` / `Runtime.getHeapUsage`), which Firefox and
// WebKit don't expose. One project = one CI hardware profile (the acceptance
// line pins the budget to a single profile). Locally, `--project=msedge`
// (this network blocks Playwright's browser CDN; msedge is Chromium too, so
// CDP still works).
export default defineConfig({
  testDir: 'bench',
  testMatch: '**/*.bench.spec.ts',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 120_000, // the 5k/20k sampling run does ~900 synchronous frames
  reporter: [['list'], ['json', { outputFile: 'bench-results/report.json' }]],
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    process.env.CI
      ? { name: 'chromium', use: { ...devices['Desktop Chrome'] } }
      : { name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } },
  ],
  webServer: {
    command: 'pnpm --filter examples dev --port 4173 --strictPort',
    url: 'http://localhost:4173',
    reuseExistingServer: !process.env.CI,
  },
});
