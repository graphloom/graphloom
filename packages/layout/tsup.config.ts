import { defineConfig } from 'tsup';

// Same wiring as @graphloom/history: tsconfig paths map core to source for
// `tsc -b`; the dts pass resolves core's built d.ts instead (nx builds core
// first via dependsOn: ^build), and composite projects reject entry-only
// file lists (TS6307).
export default defineConfig({
  // worker.ts is a second, standalone entry: it must build to its own
  // dist/worker.js, loadable directly via `new Worker(url)` — never bundled
  // together with index.js (see worker.ts's main-thread-safety guard).
  // splitting: false keeps worker.js fully self-contained — with splitting
  // on, tsup extracts the code both entries share (tree/layered/force/etc.)
  // into a shared chunk, and worker.js's side-effecting bootstrap ends up
  // *inside that chunk*, not in worker.js itself. package.json's
  // `sideEffects` array can only name worker.js (its content-hashed chunk
  // filename isn't stable across builds), so downstream tree-shaking would
  // silently drop the bootstrap from production builds — caught by
  // building apps/examples and finding a 0-byte worker chunk.
  splitting: false,
  entry: ['src/index.ts', 'src/worker.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: { compilerOptions: { composite: false, paths: {} } },
});
