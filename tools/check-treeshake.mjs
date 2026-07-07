// P1-T04 acceptance: prove the build output is tree-shakable. Bundles a probe
// that imports one export from @graphloom/core and asserts the other export's
// value string was dropped from the bundle.
import { build } from 'esbuild';

const result = await build({
  stdin: {
    contents: "import { PACKAGE_NAME } from '@graphloom/core';\nconsole.log(PACKAGE_NAME);\n",
    resolveDir: new URL('..', import.meta.url).pathname.replace(/^\/(\w:)/, '$1'),
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
