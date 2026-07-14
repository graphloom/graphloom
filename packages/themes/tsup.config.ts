import { defineConfig } from 'tsup';

// Same wiring as @graphloom/history: tsconfig paths map core to source for
// `tsc -b`; the dts pass resolves core's built d.ts instead (nx builds core
// first via dependsOn: ^build), and composite projects reject entry-only
// file lists (TS6307).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: { compilerOptions: { composite: false, paths: {} } },
});
