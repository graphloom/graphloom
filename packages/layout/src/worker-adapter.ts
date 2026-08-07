import type { LayoutEngine, LayoutGraph, LayoutResult } from './contract.js';
import type { WorkerRequest, WorkerResponse } from './worker-protocol.js';

/** The slice of the DOM `Worker` interface this adapter needs — kept structural for testability. */
export interface WorkerLike {
  postMessage(message: WorkerRequest): void;
  addEventListener(type: 'message', listener: (event: { data: WorkerResponse }) => void): void;
  removeEventListener(type: 'message', listener: (event: { data: WorkerResponse }) => void): void;
}

let nextRunId = 0;

/**
 * Wraps a worker already running this package's bootstrap into a
 * {@link LayoutEngine} that runs `engineId` off the main thread — the
 * off-main-thread half of the T01 contract's worker-execution capability.
 *
 * Point `worker` at `@graphloom/layout/worker` however your bundler exposes
 * worker entries (e.g. Vite: a local file containing
 * `import '@graphloom/layout/worker';`, constructed via
 * `new Worker(new URL('./that-file.ts', import.meta.url), { type: 'module' })`).
 * One `Worker` can be reused across runs — requests are keyed by an internal
 * run id, so concurrent/successive `compute` calls don't cross-talk.
 *
 * Cancellation (`ctx.signal`) posts a `cancel` message and resolves
 * immediately with an empty result — the runner discards it on a plain
 * cancel anyway (T01 contract), so there's no need to wait for the worker's
 * acknowledgment. On a `LayoutRunner.stop()` (live-preview commit) the
 * runner instead falls back to the last `preview` message this adapter
 * forwarded via `ctx.reportPreview` — whatever the worker had streamed as of
 * the abort, not a fresh snapshot at the exact abort instant.
 */
export function createWorkerEngine(engineId: string, worker: WorkerLike): LayoutEngine<unknown> {
  return {
    id: engineId,
    compute(graph: LayoutGraph, options: unknown, ctx): Promise<LayoutResult> {
      const runId = nextRunId++;
      return new Promise<LayoutResult>((resolve, reject) => {
        const cleanup = (): void => {
          worker.removeEventListener('message', onMessage);
          ctx.signal.removeEventListener('abort', onAbort);
        };
        const onMessage = (event: { data: WorkerResponse }): void => {
          const response = event.data;
          if (response.runId !== runId) return;
          if (response.kind === 'progress') {
            ctx.reportProgress(response.ratio);
            return;
          }
          if (response.kind === 'preview') {
            ctx.reportPreview(response.positions);
            return;
          }
          cleanup();
          if (response.kind === 'error') reject(new Error(response.message));
          else resolve({ positions: response.positions });
        };
        const onAbort = (): void => {
          cleanup();
          worker.postMessage({ kind: 'cancel', runId });
          resolve({ positions: new Map() });
        };
        worker.addEventListener('message', onMessage);
        ctx.signal.addEventListener('abort', onAbort, { once: true });
        worker.postMessage({ kind: 'run', runId, engineId, graph, options });
      });
    },
  };
}
