import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// P2-T10: core's coverage gate is raised to 90% (workspace default is 80%,
// ramping to the constitution's 95%).
export default mergeConfig(
  shared,
  defineConfig({
    test: {
      coverage: {
        thresholds: { lines: 90, functions: 90, branches: 90, statements: 90 },
      },
    },
  }),
);
