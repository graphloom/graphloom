// ADR-0006: D3 is math-only. DOM-touching d3 packages (and the umbrella
// package, which drags d3-selection in) must never enter the dependency
// graph — direct or transitive. Enforced here at resolution time; the CI
// lockfile grep (P1-T07) is the backstop.
const BANNED = new Set([
  'd3',
  'd3-selection',
  'd3-transition',
  'd3-zoom',
  'd3-drag',
  'd3-brush',
  'd3-axis',
]);

function readPackage(pkg) {
  if (BANNED.has(pkg.name)) {
    throw new Error(
      `"${pkg.name}" is banned by ADR-0006 (D3 math-only policy). ` +
        'See docs/adr/0006-d3-usage-policy.md for the allowed d3 packages.',
    );
  }
  for (const field of ['dependencies', 'optionalDependencies']) {
    for (const dep of Object.keys(pkg[field] ?? {})) {
      if (BANNED.has(dep)) {
        throw new Error(
          `"${pkg.name}" depends on banned package "${dep}" (ADR-0006 D3 math-only policy).`,
        );
      }
    }
  }
  return pkg;
}

module.exports = { hooks: { readPackage } };
