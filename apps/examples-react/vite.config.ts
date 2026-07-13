import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

// Workspace packages resolve to source (same convention as the vitest
// configs): the app builds without prior package builds. No react plugin —
// esbuild's automatic JSX runtime (tsconfig `jsx: react-jsx`) covers a demo
// that doesn't need fast refresh.
const src = (pkg: string): string =>
  fileURLToPath(new URL(`../../packages/${pkg}/src/index.ts`, import.meta.url));

export default defineConfig({
  resolve: {
    alias: {
      '@graphloom/clipboard': src('clipboard'),
      '@graphloom/core': src('core'),
      '@graphloom/history': src('history'),
      '@graphloom/interaction': src('interaction'),
      '@graphloom/react': src('react'),
      '@graphloom/rendering': src('rendering'),
    },
  },
  build: { outDir: 'dist/client' },
});
