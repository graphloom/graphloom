// ADR-0006 enforcement #3: grep the lockfile for banned d3 packages so even
// transitive dependencies cannot sneak DOM-touching d3 in. Run in CI.
import { readFileSync } from 'node:fs';

const BANNED = [
  'd3',
  'd3-selection',
  'd3-transition',
  'd3-zoom',
  'd3-drag',
  'd3-brush',
  'd3-axis',
];

const lockfile = readFileSync(new URL('../pnpm-lock.yaml', import.meta.url), 'utf8');
// Lockfile package keys look like "  d3-selection@3.0.0:" (packages section)
// or "    d3-selection: ^3.0.0" (dependency lists).
const hits = BANNED.filter((name) =>
  new RegExp(`^\\s+${name}[@:]`, 'm').test(lockfile),
);

if (hits.length > 0) {
  console.error(
    `Banned d3 packages found in pnpm-lock.yaml (ADR-0006): ${hits.join(', ')}`,
  );
  process.exit(1);
}
console.log('Lockfile clean: no banned d3 packages.');
