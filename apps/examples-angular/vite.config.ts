import angular from '@analogjs/vite-plugin-angular';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Workspace packages resolve to source (same convention as the vitest
// configs): the app builds without prior package builds, and the analog
// plugin AOT-compiles @graphloom/angular fresh — no Angular linker needed.
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  plugins: [angular({ tsconfig: './tsconfig.app.json' })],
  resolve: {
    alias: {
      '@graphloom/angular': src('angular'),
      '@graphloom/clipboard': src('clipboard'),
      '@graphloom/core': src('core'),
      '@graphloom/history': src('history'),
      '@graphloom/interaction': src('interaction'),
      '@graphloom/rendering': src('rendering'),
    },
  },
  build: { outDir: 'dist/client' },
  // Bundle @angular/* into the server build (single instance, no dual-package
  // hazards when prerender.mjs imports it under plain node).
  ssr: { noExternal: [/^@angular\//, /^rxjs/, /^tslib/] },
})
