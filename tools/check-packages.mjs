// P1-T04 / Phase Gate G7: package health. Runs publint and arethetypeswrong
// against every publishable package's build output.
import { execSync } from 'node:child_process';
import { readdirSync, existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgsDir = join(root, 'packages');

// Every publishable package: packages/* plus the nested packages/plugins/*.
const pkgPaths = [];
for (const d of readdirSync(pkgsDir)) {
  const dir = join(pkgsDir, d);
  if (existsSync(join(dir, 'package.json'))) pkgPaths.push(dir);
  else if (d === 'plugins') {
    for (const p of readdirSync(dir)) {
      if (existsSync(join(dir, p, 'package.json'))) pkgPaths.push(join(dir, p));
    }
  }
}

let failed = false;
for (const pkgPath of pkgPaths) {
  for (const cmd of [
    `pnpm exec publint "${pkgPath}"`,
    `pnpm exec attw --pack "${pkgPath}" --profile esm-only`,
  ]) {
    try {
      execSync(cmd, { cwd: root, stdio: 'inherit' });
    } catch {
      failed = true;
    }
  }
}

// P6-T04: the react wrapper's shipped bundle must open with the RSC client
// boundary directive (esbuild preserves it from src/index.ts; a toolchain
// change that strips it must fail the gate).
const reactEntry = join(pkgsDir, 'react', 'dist', 'index.js');
if (!/^["']use client["'];/.test(readFileSync(reactEntry, 'utf8').trimStart())) {
  console.error(`${reactEntry} is missing the 'use client' directive (P6-T04)`);
  failed = true;
}

process.exit(failed ? 1 : 0);
