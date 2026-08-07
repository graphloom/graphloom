// P8 worker-execution follow-up: proves createWorkerEngine round-trips through
// a real bundler-constructed Worker (Vite), not just the in-process fake the
// package's own unit tests use. Model state only (no pixel baseline needed).
//
// P8-T04 live-preview close-out: the "run force (live preview)" button uses a
// large iteration count so the run stays in flight long enough for a real
// click on "Stop" to land mid-simulation — proving LayoutRunner.stop() commits
// through an actual Worker, not just the in-process fake worker-adapter.test.ts
// uses. The preview counter proves ctx.reportPreview positions actually
// stream to the main thread while the run is live.
import { commands, createGraph } from '@graphloom/core';
import { createHistory } from '@graphloom/history';
import { createLayoutRunner, createWorkerEngine, forceLayout, layeredLayout, treeLayout } from '@graphloom/layout';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `
  <div style="font-family: system-ui, sans-serif; padding: 16px;">
    <h1>Worker layout demo</h1>
    <p>
      <button data-testid="run-tree" type="button">Run tree layout</button>
      <button data-testid="run-layered" type="button">Run layered layout</button>
      <button data-testid="run-force" type="button">Run force layout</button>
      <button data-testid="run-force-preview" type="button">Run force layout (live preview)</button>
      <button data-testid="stop" type="button">Stop</button>
    </p>
    <pre data-testid="status">idle</pre>
    <pre data-testid="preview-count">0</pre>
    <pre data-testid="can-undo">no</pre>
  </div>
`;

const editor = createGraph({ meta: { name: 'Worker layout demo' } });
editor.transact(() => {
  editor.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 } }));
  editor.execute(commands.nodeAdd({ id: 'b', position: { x: 0, y: 0 } }));
  editor.execute(commands.nodeAdd({ id: 'c', position: { x: 0, y: 0 } }));
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  editor.execute(commands.edgeAdd({ id: 'bc', source: 'b', target: 'c' }));
});
const history = createHistory(editor);
history.clear(); // seeding is not user work — undo starts empty

const worker = new Worker(new URL('./layout-worker-entry.ts', import.meta.url), { type: 'module' });
const runner = createLayoutRunner(editor);
const status = document.querySelector('[data-testid="status"]') as HTMLElement;
const previewCountEl = document.querySelector('[data-testid="preview-count"]') as HTMLElement;
const canUndoEl = document.querySelector('[data-testid="can-undo"]') as HTMLElement;

let previewCount = 0;
runner.on('layout.preview', () => {
  previewCountEl.textContent = String(++previewCount);
});
history.on('history.changed', () => {
  canUndoEl.textContent = history.canUndo ? 'yes' : 'no';
});

const wire = (testId: string, engineId: string, options: unknown = {}): void => {
  document.querySelector(`[data-testid="${testId}"]`)!.addEventListener('click', () => {
    previewCount = 0;
    previewCountEl.textContent = '0';
    status.textContent = 'running...';
    void runner.run(createWorkerEngine(engineId, worker), { options }).then((applied) => {
      status.textContent = applied ? 'done' : 'cancelled';
    });
  });
};
wire('run-tree', treeLayout.id);
wire('run-layered', layeredLayout.id);
wire('run-force', forceLayout.id, { iterations: 100 });
wire('run-force-preview', forceLayout.id, { iterations: 20000 });

document.querySelector('[data-testid="stop"]')!.addEventListener('click', () => {
  runner.stop();
});

// Exposed for the e2e suite (assert model state, not pixels — same pattern as editorDemo).
declare global {
  interface Window {
    workerLayoutDemo: {
      editor: typeof editor;
      history: typeof history;
      runner: typeof runner;
      worker: typeof worker;
    };
  }
}
window.workerLayoutDemo = { editor, history, runner, worker };
