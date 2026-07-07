import { defineConfig } from 'vitest/config';

// Default test env is node (ADR-0002: core is import-safe without DOM);
// packages that need jsdom opt in via their own config.
// Coverage starts at 80% per the tracker's ramp plan (constitution goal: 95%).
export default defineConfig({
  test: {
    coverage: {
      provider: 'v8',
      include: ['src/**'],
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 80,
        statements: 80,
      },
    },
  },
});
