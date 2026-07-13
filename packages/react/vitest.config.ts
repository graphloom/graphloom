import { fileURLToPath } from 'node:url';
import { defineConfig, mergeConfig } from 'vitest/config';
import shared from '../../vitest.shared';

// Resolve workspace deps to source so tests never race a prior build
// (same wiring as @graphloom/history).
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../${pkg}/src/index.ts`, import.meta.url));

export default mergeConfig(
  shared,
  defineConfig({
    test: {
      environment: 'jsdom',
      // Testing Library auto-cleans between tests via the global afterEach.
      globals: true,
    },
    resolve: {
      alias: {
        '@graphloom/clipboard': src('clipboard'),
        '@graphloom/core': src('core'),
        '@graphloom/history': src('history'),
        '@graphloom/interaction': src('interaction'),
        '@graphloom/rendering': src('rendering'),
      },
    },
  }),
);
