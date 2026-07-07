import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// Core resolves to source so tests run without a prior tsup build of core.
// Default env stays node (ADR-0002: scene graph is DOM-free); the SVG
// renderer's tests opt into jsdom per-file via `// @vitest-environment jsdom`.
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
