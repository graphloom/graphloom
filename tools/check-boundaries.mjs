// P1-T05 acceptance: prove every architectural boundary rule fails loudly.
// Lints in-memory fixtures via the ESLint API against virtual file paths, so
// the path-scoped rules in eslint.config.js are exercised exactly as they
// would be for real files. Runs as part of `pnpm lint`.
import { ESLint } from 'eslint';

const cases = [
  {
    name: 'd3-selection banned everywhere (ADR-0006)',
    filePath: 'packages/rendering/src/fixture.ts',
    code: "import 'd3-selection';\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'umbrella d3 banned even in apps (ADR-0006)',
    filePath: 'apps/examples/src/fixture.ts',
    code: "import 'd3';\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'react import banned in core packages',
    filePath: 'packages/core/src/fixture.ts',
    code: "import 'react';\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: '@angular/* import banned in core packages',
    filePath: 'packages/core/src/fixture.ts',
    code: "import '@angular/core';\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'cross-package deep imports banned',
    filePath: 'packages/interaction/src/fixture.ts',
    code: "import '@graphloom/core/dist/internal.js';\n",
    expectRule: 'no-restricted-imports',
  },
  {
    name: 'explicit any fails lint',
    filePath: 'packages/core/src/fixture.ts',
    code: 'export const leak: any = 1;\n',
    expectRule: '@typescript-eslint/no-explicit-any',
  },
  {
    name: 'react import allowed in the react wrapper (control)',
    filePath: 'packages/react/src/fixture.ts',
    code: "import 'react';\n",
    expectRule: null,
  },
  {
    name: '@angular/* import allowed in the angular wrapper (control)',
    filePath: 'packages/angular/src/fixture.ts',
    code: "import '@angular/core';\n",
    expectRule: null,
  },
];

const eslint = new ESLint();
let failed = false;

for (const c of cases) {
  const [result] = await eslint.lintText(c.code, { filePath: c.filePath });
  const rules = (result?.messages ?? []).map((m) => m.ruleId);
  const ok = c.expectRule ? rules.includes(c.expectRule) : rules.length === 0;
  if (!ok) {
    failed = true;
    console.error(
      `FAIL ${c.name}\n  expected ${c.expectRule ?? 'no errors'}, got [${rules.join(', ')}]`,
    );
  } else {
    console.log(`ok   ${c.name}`);
  }
}

if (failed) {
  console.error('\nBoundary rules are NOT being enforced — see eslint.config.js');
  process.exit(1);
}
console.log('\nAll architectural boundary rules enforced.');
