import { defineConfig } from 'tsup';

// The workspace tsconfigs are composite (for `tsc -b` project references),
// but tsup's dts worker builds from the entry file only, which composite
// projects reject (TS6307). Turn it off for the dts pass alone.
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: { compilerOptions: { composite: false } },
});
