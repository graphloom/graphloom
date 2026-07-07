// P1-T04 / Phase Gate G7: package health. Runs publint and arethetypeswrong
// against every publishable package's build output.
import { execSync } from 'node:child_process';
import { readdirSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join } from 'node:path';

const root = fileURLToPath(new URL('..', import.meta.url));
const pkgsDir = join(root, 'packages');
const dirs = readdirSync(pkgsDir).filter((d) =>
  existsSync(join(pkgsDir, d, 'package.json')),
);

let failed = false;
for (const dir of dirs) {
  const pkgPath = join(pkgsDir, dir);
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

process.exit(failed ? 1 : 0);
