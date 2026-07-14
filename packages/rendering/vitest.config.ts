import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// Workspace deps resolve to source so tests run without a prior tsup build.
// Default env stays node (ADR-0002: scene graph is DOM-free); the SVG
// renderer's tests opt into jsdom per-file via `// @vitest-environment jsdom`.
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default mergeConfig(
  shared,
  defineConfig({
    resolve: {
      alias: {
        '@graphloom/core': src('core'),
        '@graphloom/themes': src('themes'),
      },
    },
  }),
);
