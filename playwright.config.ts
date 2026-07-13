import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'e2e',
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  use: { baseURL: 'http://localhost:4173' },
  projects: [
    { name: 'chromium', use: { ...devices['Desktop Chrome'] } },
    { name: 'firefox', use: { ...devices['Desktop Firefox'] } },
    { name: 'webkit', use: { ...devices['Desktop Safari'] } },
    // ponytail: local-only escape hatch — this network blocks Playwright's
    // browser CDN, so local smokes use the OS-installed Edge
    // (`pnpm e2e --project=msedge`); CI runs only the three real engines
    // above (ubuntu runners ship Edge too, which would demand a fourth,
    // redundant ≈Chromium visual baseline).
    ...(process.env.CI
      ? []
      : [{ name: 'msedge', use: { ...devices['Desktop Edge'], channel: 'msedge' } }]),
  ],
  webServer: [
    {
      command: 'pnpm --filter examples dev --port 4173 --strictPort',
      url: 'http://localhost:4173',
      reuseExistingServer: !process.env.CI,
    },
    {
      // Built + prerendered (not a dev server): the hydration smoke needs
      // real SSR HTML on the wire.
      command: 'pnpm --filter examples-angular serve',
      url: 'http://localhost:4301',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
    {
      // Same deal for the React demo (P6): prerendered SSR output.
      command: 'pnpm --filter examples-react serve',
      url: 'http://localhost:4302',
      reuseExistingServer: !process.env.CI,
      timeout: 180_000,
    },
  ],
});
