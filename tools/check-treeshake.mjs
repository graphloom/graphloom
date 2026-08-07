// P1-T04 acceptance: prove the build output is tree-shakable. Bundles a probe
// that imports one export from @graphloom/core and asserts the other export's
// value string was dropped from the bundle.
import { build } from 'esbuild';

const resolveDir = new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1');

const result = await build({
  stdin: {
    contents: "import { PACKAGE_NAME } from '@graphloom/core';\nconsole.log(PACKAGE_NAME);\n",
    resolveDir,
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  treeShaking: true,
});

const bundle = result.outputFiles[0].text;
if (!bundle.includes('@graphloom/core')) {
  console.error('Probe bundle is missing the import it was supposed to keep.');
  process.exit(1);
}
if (bundle.includes('CORE_TREESHAKE_CANARY')) {
  console.error('Tree-shaking FAILED: unused export leaked into the probe bundle.');
  process.exit(1);
}
console.log('Tree-shaking verified: unused export dropped from probe bundle.');

// P8 worker-execution regression guard: @graphloom/layout/worker is a
// side-effect-only import (self.onmessage wiring, no named exports used) —
// exactly the shape a bundler's tree-shaker can legally drop unless
// package.json's `sideEffects` correctly protects it. A prior build
// (tsup's default code-splitting) passed every local check yet shipped a
// 0-byte worker bundle in production, caught only by hand-inspecting a real
// `vite build` — this probe makes that failure mode a normal CI assertion.
const workerResult = await build({
  stdin: {
    contents: "import '@graphloom/layout/worker';\n",
    // resolveDir must be somewhere @graphloom/layout is an actual dependency
    // (the repo root only depends on @graphloom/core) — apps/examples
    // depends on it for the P8 worker demo.
    resolveDir: new URL('../apps/examples', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
    loader: 'ts',
  },
  bundle: true,
  format: 'esm',
  write: false,
  treeShaking: true,
  // apps/examples/tsconfig.json maps this specifier straight to source (its
  // own dist-less-typecheck trick, unrelated to this probe) — esbuild
  // auto-discovers that tsconfig and would follow the mapping, skipping the
  // real node_modules/package.json resolution a downstream consumer's
  // bundler actually does. An empty override disables the auto-discovery.
  tsconfigRaw: '{}',
});

const workerBundle = workerResult.outputFiles[0].text;
if (!workerBundle.includes('onmessage')) {
  console.error(
    'Tree-shaking FAILED: @graphloom/layout/worker lost its onmessage wiring when bundled ' +
      '(a bare side-effect import must survive — check package.json "sideEffects").',
  );
  process.exit(1);
}
console.log('Tree-shaking verified: @graphloom/layout/worker bootstrap survives bundling.');
