import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// Resolve core to its source so tests run without a prior tsup build of core.
export default mergeConfig(
  shared,
  defineConfig({
    resolve: {
      alias: {
        '@graphloom/core': fileURLToPath(new URL('../core/src/index.ts', import.meta.url)),
      },
    },
  }),
);
