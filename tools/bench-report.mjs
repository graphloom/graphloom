// P9-T03 benchmark gate + trend formatter. Reads bench-results/metrics.json
// (written by bench/graphloom.bench.spec.ts) and:
//   1. writes bench-results/benchmark.json in benchmark-action's
//      `customSmallerIsBetter` shape — kept in the CI artifact; wiring a
//      github-action-benchmark trend dashboard on top is a P9-T03 follow-up;
//   2. gates the job on:
//        - the ADR-0007 frame budget for the SVG backend at 500/2000 (the
//          framework default; the budget in the ADR was written against it);
//        - flat heap after churn and after editor create→use→destroy ×100;
//        - <10% run-to-run variance on the gated SVG metric (the acceptance
//          line's "else fix the harness first" guard). Non-gated configs
//          report their CV but don't fail the job.
//      A breach exits non-zero and blocks merge.
//   3. reports — never gates — the Canvas backend and the 5k/20k headroom
//      runs. Canvas full-frame repaint on pan/zoom is above 16ms at the
//      limits; closing that (partial-pan blit + the static/active layer split
//      deferred from P9-T01) is tracked in P9-T04.
// The trend file is written before the gate so a regression still records its
// data point.
import { readFileSync, writeFileSync } from 'node:fs';

const FRAME_BUDGET_MS = 16; // ADR-0007: 60fps / <16ms at 500 nodes / 2000 edges
const INITIAL_RENDER_BUDGET_MS = 500;
const HEAP_GROWTH_BUDGET_PCT = 10;
const MAX_CV = 0.1; // run-to-run coefficient of variation

const EXPECTED = [
  'svg 500x2000',
  'canvas 500x2000',
  'canvas 5000x20000',
  'heap',
  'lifecycle-svg',
  'lifecycle-canvas',
];

// Heap-style metrics carry a growthPct; the rest carry latency samples.
const isHeap = (r) => typeof r?.growthPct === 'number';
const heapLabel = (label, r) =>
  label === 'heap'
    ? `heap growth / ${r.churnCycles} churn cycles`
    : `heap growth / ${r.iterations}× ${label.replace('lifecycle-', '')} create→destroy`;

const round = (x) => Math.round(x * 100) / 100;
const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
const cv = (xs) => {
  const m = mean(xs);
  return m === 0 ? 0 : Math.sqrt(mean(xs.map((x) => (x - m) ** 2))) / m;
};

const metrics = JSON.parse(readFileSync('bench-results/metrics.json', 'utf8'));

const missing = EXPECTED.filter((k) => !(k in metrics));
if (missing.length > 0) {
  console.error(`bench-report: metrics.json is missing ${missing.join(', ')} — a bench test failed.`);
  process.exit(1);
}

// ---- 1. trend file -----------------------------------------------------
const trend = [];
for (const [label, r] of Object.entries(metrics)) {
  if (isHeap(r)) {
    trend.push({ name: heapLabel(label, r), unit: '%', value: round(r.growthPct) });
    continue;
  }
  trend.push(
    { name: `${label} — build`, unit: 'ms', value: round(r.build) },
    { name: `${label} — initial render`, unit: 'ms', value: round(r.initialRender) },
    { name: `${label} — pan p95`, unit: 'ms', value: round(r.panP95) },
    { name: `${label} — zoom p95`, unit: 'ms', value: round(r.zoomP95) },
    { name: `${label} — drag median`, unit: 'ms', value: round(r.dragMedian) },
  );
}
writeFileSync('bench-results/benchmark.json', `${JSON.stringify(trend, null, 2)}\n`);

// ---- 2 + 3. gate + report -------------------------------------------
const budgetFailures = [];
const varianceFailures = [];

for (const [label, r] of Object.entries(metrics)) {
  if (isHeap(r)) {
    const line = `${heapLabel(label, r)}: +${round(r.growthPct)}% (budget <${HEAP_GROWTH_BUDGET_PCT}%)`;
    if (r.growthPct >= HEAP_GROWTH_BUDGET_PCT) budgetFailures.push(line);
    console.log(line);
    continue;
  }

  const strict = r.renderer === 'svg' && r.nodes <= 500 && r.edges <= 2000;

  // Harness health. Gated only on the config the budget is pinned to (SVG
  // 500/2000): that number must be trustworthy. The 5k/20k canvas headroom
  // run has inherent workload variance (full repaint of 25k items + GC) and
  // its metrics are trend-only (P9-T04) — a noisy CV there is expected, so
  // report it but don't fail the job.
  for (const [name, samples] of [['pan', r.panMedians], ['zoom', r.zoomMedians], ['drag', r.dragMedians]]) {
    const v = cv(samples);
    if (v < MAX_CV) continue;
    const line = `${label} ${name}: CV ${(v * 100).toFixed(1)}% over ${samples.length} runs (max ${MAX_CV * 100}%) — [${samples.map(round).join(', ')}]`;
    if (strict) varianceFailures.push(line);
    else console.log(`  (trend-only) high variance — ${line}`);
  }

  const checks = [
    ['initial render', r.initialRender, INITIAL_RENDER_BUDGET_MS],
    ['pan p95', r.panP95, FRAME_BUDGET_MS],
    ['zoom p95', r.zoomP95, FRAME_BUDGET_MS],
    ['drag median', r.dragMedian, FRAME_BUDGET_MS],
  ];
  const over = checks.filter(([, value, budget]) => value >= budget).map(([m]) => m);
  console.log(
    `${label}: build ${round(r.build)}ms · initial ${round(r.initialRender)}ms · pan p95 ` +
      `${round(r.panP95)}ms · zoom p95 ${round(r.zoomP95)}ms · drag ${round(r.dragMedian)}ms` +
      (over.length === 0 ? '' : `  [${strict ? 'OVER BUDGET' : 'over 16ms — trend only, tracked P9-T04'}: ${over.join(', ')}]`),
  );
  if (strict) {
    for (const [metric, value, budget] of checks) {
      if (value >= budget) budgetFailures.push(`${label}: ${metric} ${round(value)}ms (budget <${budget}ms)`);
    }
  }
}

if (varianceFailures.length > 0) {
  console.error(`\nHarness variance over ${MAX_CV * 100}% — fix the harness before trusting the budget:`);
  for (const f of varianceFailures) console.error(`  x ${f}`);
}
if (budgetFailures.length > 0) {
  console.error('\nADR-0007 budget exceeded:');
  for (const f of budgetFailures) console.error(`  x ${f}`);
}
if (varianceFailures.length > 0 || budgetFailures.length > 0) process.exit(1);
console.log('\nbench-report: SVG frame budget green, heap flat, harness variance within 10%.');
