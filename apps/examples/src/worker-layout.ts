// P8 worker-execution follow-up: proves createWorkerEngine round-trips through
// a real bundler-constructed Worker (Vite), not just the in-process fake the
// package's own unit tests use. Model state only (no pixel baseline needed).
import { commands, createGraph } from '@graphloom/core';
import { createLayoutRunner, createWorkerEngine, forceLayout, layeredLayout, treeLayout } from '@graphloom/layout';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `
  <div style="font-family: system-ui, sans-serif; padding: 16px;">
    <h1>Worker layout demo</h1>
    <p>
      <button data-testid="run-tree" type="button">Run tree layout</button>
      <button data-testid="run-layered" type="button">Run layered layout</button>
      <button data-testid="run-force" type="button">Run force layout</button>
    </p>
    <pre data-testid="status">idle</pre>
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

const worker = new Worker(new URL('./layout-worker-entry.ts', import.meta.url), { type: 'module' });
const runner = createLayoutRunner(editor);
const status = document.querySelector('[data-testid="status"]') as HTMLElement;

const wire = (testId: string, engineId: string, options: unknown = {}): void => {
  document.querySelector(`[data-testid="${testId}"]`)!.addEventListener('click', () => {
    status.textContent = 'running...';
    void runner.run(createWorkerEngine(engineId, worker), { options }).then((applied) => {
      status.textContent = applied ? 'done' : 'cancelled';
    });
  });
};
wire('run-tree', treeLayout.id);
wire('run-layered', layeredLayout.id);
wire('run-force', forceLayout.id, { iterations: 100 });

// Exposed for the e2e suite (assert model state, not pixels — same pattern as editorDemo).
declare global {
  interface Window {
    workerLayoutDemo: { editor: typeof editor; runner: typeof runner; worker: typeof worker };
  }
}
window.workerLayoutDemo = { editor, runner, worker };
