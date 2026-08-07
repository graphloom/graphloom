import { circularLayout, gridLayout, radialLayout } from './simple.js';
import type { LayoutEngine } from './contract.js';
import { forceLayout } from './force.js';
import { layeredLayout } from './layered.js';
import { treeLayout } from './tree.js';
import type { WorkerRequest, WorkerResponse } from './worker-protocol.js';

/** Every built-in engine, keyed by id — the default registry for a worker bootstrap. */
export const BUILTIN_ENGINES: ReadonlyMap<string, LayoutEngine<never>> = new Map([
  [treeLayout.id, treeLayout as LayoutEngine<never>],
  [layeredLayout.id, layeredLayout as LayoutEngine<never>],
  [forceLayout.id, forceLayout as LayoutEngine<never>],
  [gridLayout.id, gridLayout as LayoutEngine<never>],
  [circularLayout.id, circularLayout as LayoutEngine<never>],
  [radialLayout.id, radialLayout as LayoutEngine<never>],
]);

/**
 * Decodes and runs one {@link WorkerRequest} against `engines`, posting
 * responses via `post`. Pure aside from `post`/`controllers` — this is what
 * a worker bootstrap wires to `onmessage`, but it's plain async code so it's
 * testable without a real `Worker`. `controllers` is caller-owned so a
 * bootstrap can share one map across every message it handles.
 */
export async function handleWorkerRequest(
  request: WorkerRequest,
  engines: ReadonlyMap<string, LayoutEngine<never>>,
  post: (response: WorkerResponse) => void,
  controllers: Map<number, AbortController>,
): Promise<void> {
  if (request.kind === 'cancel') {
    controllers.get(request.runId)?.abort();
    return;
  }
  const engine = engines.get(request.engineId);
  if (!engine) {
    post({ kind: 'error', runId: request.runId, message: `unknown layout engine: ${request.engineId}` });
    return;
  }
  const controller = new AbortController();
  controllers.set(request.runId, controller);
  try {
    const result = await engine.compute(request.graph, request.options as never, {
      signal: controller.signal,
      reportProgress: (ratio) => post({ kind: 'progress', runId: request.runId, ratio }),
      reportPreview: (positions) => post({ kind: 'preview', runId: request.runId, positions }),
    });
    post({ kind: 'result', runId: request.runId, positions: result.positions });
  } catch (error) {
    post({
      kind: 'error',
      runId: request.runId,
      message: error instanceof Error ? error.message : String(error),
    });
  } finally {
    controllers.delete(request.runId);
  }
}

// Worker bootstrap: wires the built-in registry to this file's global scope.
// `window` is never defined in a worker (unlike `self`, which aliases
// `window` on the main thread) — the safest way to tell the two apart
// without pulling in the (DOM-incompatible) "webworker" lib just for this
// one guard.
interface WorkerLikeScope {
  postMessage(message: WorkerResponse): void;
  onmessage: ((event: { data: WorkerRequest }) => void) | null;
}
if (typeof window === 'undefined' && typeof self !== 'undefined') {
  const scope = self as unknown as WorkerLikeScope;
  if (typeof scope.postMessage === 'function') {
    const controllers = new Map<number, AbortController>();
    scope.onmessage = (event) => {
      void handleWorkerRequest(event.data, BUILTIN_ENGINES, (r) => scope.postMessage(r), controllers);
    };
  }
}
