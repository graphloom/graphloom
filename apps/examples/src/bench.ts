// P9-T03 benchmark fixture: a synthetic graph at a requested scale, driven
// headlessly by bench/*.bench.spec.ts. Not linked from any nav, not visually
// baselined — the benchmark harness is its only consumer.
//
// ADR-0007's 500/2000 limit is enforced at the command boundary; the
// headroom-trend runs raise it through the public `limits` option — the same
// knob a user on bigger hardware would turn — so the real CommandBus path is
// still exercised. Nothing here bypasses it.
import { commands, createGraph } from '@graphloom/core';
import { createHistory } from '@graphloom/history';
import { createCanvasRenderer, createSvgRenderer, mountRenderer } from '@graphloom/rendering';

const params = new URLSearchParams(location.search);
const nodeCount = Number(params.get('nodes') ?? 500);
const edgeCount = Number(params.get('edges') ?? 2000);
const useCanvas = params.get('renderer') === 'canvas';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `<style>body{margin:0}#canvas{position:fixed;inset:0}</style><div id="canvas"></div>`;
const canvasHost = document.querySelector('#canvas') as HTMLElement;

const editor = createGraph({ limits: { maxNodes: Infinity, maxEdges: Infinity } });
const cols = Math.ceil(Math.sqrt(nodeCount));

const buildStart = performance.now();
editor.transact(() => {
  for (let i = 0; i < nodeCount; i++) {
    editor.execute(
      commands.nodeAdd({
        id: `n${i}`,
        position: { x: (i % cols) * 160, y: Math.floor(i / cols) * 100 },
        size: { width: 120, height: 48 },
        data: { label: `Node ${i}` },
      }),
    );
  }
  for (let i = 0; i < edgeCount; i++) {
    const source = i % nodeCount;
    let target = (i * 7 + 1) % nodeCount;
    if (target === source) target = (target + 1) % nodeCount;
    editor.execute(commands.edgeAdd({ id: `e${i}`, source: `n${source}`, target: `n${target}` }));
  }
});
const build = performance.now() - buildStart;

const history = createHistory(editor);

const renderStart = performance.now();
const host = mountRenderer(
  editor,
  useCanvas ? createCanvasRenderer() : createSvgRenderer(),
  canvasHost,
);
host.viewport.zoomToFit(host.scene.bounds(), 40);
host.renderNow();
const initialRender = performance.now() - renderStart;

const median = (xs: readonly number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const percentile = (xs: readonly number[], p: number): number => {
  const s = [...xs].sort((a, b) => a - b);
  return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))]!;
};

// One "frame" = the synchronous pipeline cost behind one interactive update
// (scene derive + cull + frame build + renderer mutation). ADR-0007's <16ms
// budget governs exactly this JS work; real compositor time on a shared CI
// runner is too noisy to gate on (tracker note P9-T03).
const REPS = 4;
const FRAMES_PER_REP = 25;

const runMetric = (step: () => void): { p95: number; medians: number[] } => {
  const medians: number[] = [];
  let p95 = 0;
  for (let r = 0; r < REPS; r++) {
    const samples: number[] = [];
    for (let f = 0; f < FRAMES_PER_REP; f++) {
      const t = performance.now();
      step();
      host.renderNow();
      samples.push(performance.now() - t);
    }
    medians.push(median(samples));
    p95 = Math.max(p95, percentile(samples, 95));
  }
  return { p95, medians };
};

/** Runs every latency metric and returns the summary the harness records. */
const run = (): BenchResults => {
  let panSign = 1;
  const pan = runMetric(() => {
    host.viewport.panBy(17 * panSign, 11 * panSign);
    panSign *= -1;
  });
  let zoomIn = true;
  const zoom = runMetric(() => {
    host.viewport.zoomBy(zoomIn ? 1.05 : 1 / 1.05);
    zoomIn = !zoomIn;
  });
  let dragX = 0;
  const drag = runMetric(() => {
    dragX = (dragX + 13) % 400;
    editor.execute(commands.nodeUpdate('n0', { position: { x: dragX, y: 40 } }));
  });
  return {
    nodes: nodeCount,
    edges: edgeCount,
    renderer: useCanvas ? 'canvas' : 'svg',
    build,
    initialRender,
    panP95: pan.p95,
    panMedians: pan.medians,
    zoomP95: zoom.p95,
    zoomMedians: zoom.medians,
    dragMedian: median(drag.medians),
    dragMedians: drag.medians,
  };
};

// Add a node + incident edge, repaint, undo, repaint — model/inverse churn in
// history plus add/remove DOM churn in the renderer. Heap is sampled by the
// spec (CDP GC + Runtime.getHeapUsage) around this.
const churn = (cycles: number): void => {
  for (let i = 0; i < cycles; i++) {
    editor.transact(() => {
      editor.execute(
        commands.nodeAdd({ id: `churn${i}`, position: { x: 0, y: 0 }, size: { width: 80, height: 40 } }),
      );
      editor.execute(commands.edgeAdd({ id: `ce${i}`, source: `churn${i}`, target: 'n0' }));
    });
    host.renderNow();
    history.undo();
    host.renderNow();
  }
};

/** Latency summary for one (scale × backend) run. */
export interface BenchResults {
  readonly nodes: number;
  readonly edges: number;
  readonly renderer: 'svg' | 'canvas';
  readonly build: number;
  readonly initialRender: number;
  readonly panP95: number;
  readonly panMedians: number[];
  readonly zoomP95: number;
  readonly zoomMedians: number[];
  readonly dragMedian: number;
  readonly dragMedians: number[];
}

declare global {
  interface Window {
    __bench: { ready: true; run: () => BenchResults; churn: (cycles: number) => void };
  }
}
window.__bench = { ready: true, run, churn };
