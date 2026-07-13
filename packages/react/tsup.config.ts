import { defineConfig } from 'tsup';

// tsconfig.json maps workspace deps to source for `tsc -b` on a clean clone;
// tsup's dts pass must instead resolve built d.ts from node_modules (deps are
// always built first — nx `dependsOn: ^build`), and composite projects reject
// entry-only file lists (TS6307). esbuild preserves the entry's 'use client'
// directive at the top of the bundle (P6-T04); tools/check-packages.mjs
// asserts it on the built artifact so a toolchain regression fails the gate.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: { compilerOptions: { composite: false, paths: {} } },
});
