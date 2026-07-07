import { defineConfig } from 'tsup';

// tsconfig.json maps @graphloom/core to its source for `tsc -b` on a clean
// clone; tsup's dts pass must instead resolve the built d.ts from
// node_modules (core is always built first — nx `dependsOn: ^build`), and
// composite projects reject entry-only file lists (TS6307).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: { compilerOptions: { composite: false, paths: {} } },
});
