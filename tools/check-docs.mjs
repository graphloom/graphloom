// P2-T10 acceptance: prove every exported symbol carries an API doc comment.
// typedoc/api-extractor don't support TypeScript 6.x yet (see tracker Decision
// Log), so this checks the same invariant directly: every top-level `export`
// declaration in package sources must be immediately preceded by a TSDoc
// block (`*/` on the previous non-blank line). Runs as part of `pnpm lint`.
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const PACKAGES = ['packages/core/src', 'packages/history/src'];
const DECL = /^export\s+(?:abstract\s+)?(?:const|function|class|interface|enum|type)\s+\w+/;

let failures = 0;
for (const dir of PACKAGES) {
  for (const file of readdirSync(dir)) {
    if (!file.endsWith('.ts') || file.endsWith('.test.ts')) continue;
    const lines = readFileSync(join(dir, file), 'utf8').split('\n');
    lines.forEach((line, i) => {
      if (!DECL.test(line)) return;
      let j = i - 1;
      while (j >= 0 && lines[j].trim() === '') j--;
      if (j < 0 || !lines[j].trim().endsWith('*/')) {
        console.error(`${join(dir, file)}:${i + 1} exported symbol has no TSDoc comment`);
        failures++;
      }
    });
  }
}

if (failures > 0) {
  console.error(`check-docs: ${failures} undocumented export(s).`);
  process.exit(1);
}
console.log('check-docs: every exported symbol is documented.');
