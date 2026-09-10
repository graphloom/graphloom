import { defineConfig } from 'tsup';

// Same wiring as @graphloom/clipboard: tsconfig paths map the workspace deps
// to source for `tsc -b`; the dts pass resolves their built d.ts instead (nx
// builds deps first via dependsOn: ^build), and composite projects reject
// entry-only file lists (TS6307).
export default defineConfig({
  entry: ['src/index.ts'],
  format: ['esm'],
  sourcemap: true,
  clean: true,
  dts: { compilerOptions: { composite: false, paths: {} } },
});
