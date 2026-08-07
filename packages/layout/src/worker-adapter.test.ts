import { expect, it } from 'vitest';
import type { LayoutContext, LayoutGraph } from './contract.js';
import { createWorkerEngine, type WorkerLike } from './worker-adapter.js';
import { handleWorkerRequest } from './worker.js';
import type { WorkerRequest, WorkerResponse } from './worker-protocol.js';
import { BUILTIN_ENGINES } from './worker.js';

/** Round-trips messages through the real protocol handler in-process — no real thread, but proves the wire format. */
class FakeWorker implements WorkerLike {
  #listeners = new Set<(event: { data: WorkerResponse }) => void>();
  #controllers = new Map<number, AbortController>();
  #cancelled = false;

  postMessage(message: WorkerRequest): void {
    if (this.#cancelled) return;
    void handleWorkerRequest(message, BUILTIN_ENGINES, (response) => {
      for (const listener of this.#listeners) listener({ data: response });
    }, this.#controllers);
  }

  addEventListener(_type: 'message', listener: (event: { data: WorkerResponse }) => void): void {
    this.#listeners.add(listener);
  }

  removeEventListener(_type: 'message', listener: (event: { data: WorkerResponse }) => void): void {
    this.#listeners.delete(listener);
  }
}

const ctx: LayoutContext = { signal: new AbortController().signal, reportProgress: () => {} };

function node(id: string): LayoutGraph['nodes'][number] {
  return { id, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } };
}

it('runs an engine on the worker and resolves with its result', async () => {
  const graph: LayoutGraph = { nodes: [node('a'), node('b')], edges: [] };
  const engine = createWorkerEngine('grid', new FakeWorker());

  const { positions } = await engine.compute(graph, {}, ctx);

  expect(positions.size).toBe(2);
});

it('rejects when the worker reports an unknown engine', async () => {
  const engine = createWorkerEngine('does-not-exist', new FakeWorker());

  await expect(engine.compute({ nodes: [], edges: [] }, {}, ctx)).rejects.toThrow('does-not-exist');
});

it('forwards progress reports from the worker to ctx.reportProgress', async () => {
  const seen: number[] = [];
  const localCtx: LayoutContext = {
    signal: new AbortController().signal,
    reportProgress: (ratio) => seen.push(ratio),
  };
  const engine = createWorkerEngine('force', new FakeWorker());

  await engine.compute({ nodes: [node('a'), node('b')], edges: [] }, { iterations: 20 }, localCtx);

  expect(seen.length).toBeGreaterThan(0);
});

it('does not cross-talk between two concurrent runs on the same worker', async () => {
  const worker = new FakeWorker();
  const graphA: LayoutGraph = { nodes: [node('a')], edges: [] };
  const graphB: LayoutGraph = { nodes: [node('b'), node('c')], edges: [] };
  const engineA = createWorkerEngine('grid', worker);
  const engineB = createWorkerEngine('circular', worker);

  const [resultA, resultB] = await Promise.all([
    engineA.compute(graphA, {}, ctx),
    engineB.compute(graphB, {}, ctx),
  ]);

  expect(resultA.positions.size).toBe(1);
  expect(resultB.positions.size).toBe(2);
});

it('resolves immediately on abort, posting a cancel message and not waiting for the worker', async () => {
  const controller = new AbortController();
  const posted: WorkerRequest[] = [];
  const worker: WorkerLike = {
    postMessage: (m) => posted.push(m),
    addEventListener: () => {},
    removeEventListener: () => {},
  };
  const engine = createWorkerEngine('grid', worker);
  const localCtx: LayoutContext = { signal: controller.signal, reportProgress: () => {} };

  const pending = engine.compute({ nodes: [], edges: [] }, {}, localCtx);
  controller.abort();
  const result = await pending;

  expect(result.positions.size).toBe(0);
  expect(posted.some((m) => m.kind === 'cancel')).toBe(true);
});
