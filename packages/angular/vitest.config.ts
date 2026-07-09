import angular from '@analogjs/vite-plugin-angular';
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
    // Runs the Angular compiler over components so initializer APIs
    // (input/output/viewChild) register — plain esbuild JIT can't see them.
    plugins: [angular({ tsconfig: './tsconfig.spec.json' })],
    test: {
      environment: 'jsdom',
      setupFiles: ['./test-setup.ts'],
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
