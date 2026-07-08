import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// Resolve workspace deps to source so tests never race a prior tsup build
// (same wiring as @graphloom/history).
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default mergeConfig(
  shared,
  defineConfig({
    resolve: {
      alias: {
        '@graphloom/core': src('core'),
        '@graphloom/history': src('history'),
      },
    },
  }),
);
