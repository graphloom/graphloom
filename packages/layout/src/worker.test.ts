import { expect, it, vi } from 'vitest';
import type { LayoutContext, LayoutEngine, LayoutGraph } from './contract.js';
import { BUILTIN_ENGINES, handleWorkerRequest } from './worker.js';
import type { WorkerRequest, WorkerResponse } from './worker-protocol.js';

function node(id: string): LayoutGraph['nodes'][number] {
  return { id, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } };
}

it('registers every built-in engine under its id', () => {
  for (const id of ['tree', 'layered', 'force', 'grid', 'circular', 'radial']) {
    expect(BUILTIN_ENGINES.get(id)?.id).toBe(id);
  }
});

it('runs a known engine and posts its result', async () => {
  const graph: LayoutGraph = { nodes: [node('a'), node('b')], edges: [] };
  const request: WorkerRequest = { kind: 'run', runId: 1, engineId: 'grid', graph, options: {} };
  const post = vi.fn<(r: WorkerResponse) => void>();

  await handleWorkerRequest(request, BUILTIN_ENGINES, post, new Map());

  expect(post).toHaveBeenCalledTimes(1);
  const [response] = post.mock.calls[0]!;
  expect(response.kind).toBe('result');
  expect(response.runId).toBe(1);
});

it('posts an error for an unknown engine id without throwing', async () => {
  const request: WorkerRequest = {
    kind: 'run',
    runId: 2,
    engineId: 'nope',
    graph: { nodes: [], edges: [] },
    options: {},
  };
  const post = vi.fn<(r: WorkerResponse) => void>();

  await handleWorkerRequest(request, BUILTIN_ENGINES, post, new Map());

  expect(post).toHaveBeenCalledWith({ kind: 'error', runId: 2, message: expect.stringContaining('nope') });
});

it('posts an error when the engine throws', async () => {
  const engines = new Map<string, LayoutEngine<never>>([
    ['broken', { id: 'broken', compute: () => Promise.reject(new Error('boom')) } as LayoutEngine<never>],
  ]);
  const request: WorkerRequest = {
    kind: 'run',
    runId: 3,
    engineId: 'broken',
    graph: { nodes: [], edges: [] },
    options: {},
  };
  const post = vi.fn<(r: WorkerResponse) => void>();

  await handleWorkerRequest(request, engines, post, new Map());

  expect(post).toHaveBeenCalledWith({ kind: 'error', runId: 3, message: 'boom' });
});

it('forwards progress reports before the result', async () => {
  const engines = new Map<string, LayoutEngine<never>>([
    [
      'progressive',
      {
        id: 'progressive',
        async compute(graph: LayoutGraph, _options: never, ctx: LayoutContext) {
          ctx.reportProgress(0.5);
          return { positions: new Map() };
        },
      } as LayoutEngine<never>,
    ],
  ]);
  const request: WorkerRequest = {
    kind: 'run',
    runId: 4,
    engineId: 'progressive',
    graph: { nodes: [], edges: [] },
    options: {},
  };
  const posted: WorkerResponse[] = [];

  await handleWorkerRequest(request, engines, (r) => posted.push(r), new Map());

  expect(posted[0]).toEqual({ kind: 'progress', runId: 4, ratio: 0.5 });
  expect(posted[1]?.kind).toBe('result');
});

it('forwards preview positions before the result', async () => {
  const engines = new Map<string, LayoutEngine<never>>([
    [
      'previewing',
      {
        id: 'previewing',
        async compute(graph: LayoutGraph, _options: never, ctx: LayoutContext) {
          ctx.reportPreview(new Map([['a', { x: 1, y: 2 }]]));
          return { positions: new Map() };
        },
      } as LayoutEngine<never>,
    ],
  ]);
  const request: WorkerRequest = {
    kind: 'run',
    runId: 6,
    engineId: 'previewing',
    graph: { nodes: [], edges: [] },
    options: {},
  };
  const posted: WorkerResponse[] = [];

  await handleWorkerRequest(request, engines, (r) => posted.push(r), new Map());

  expect(posted[0]).toEqual({ kind: 'preview', runId: 6, positions: new Map([['a', { x: 1, y: 2 }]]) });
  expect(posted[1]?.kind).toBe('result');
});

it('cancel aborts the matching in-flight run via its controller', async () => {
  let sawAbort = false;
  const gate = Promise.resolve();
  const engines = new Map<string, LayoutEngine<never>>([
    [
      'slow',
      {
        id: 'slow',
        async compute(_graph: LayoutGraph, _options: never, ctx: LayoutContext) {
          await gate;
          sawAbort = ctx.signal.aborted;
          return { positions: new Map() };
        },
      } as LayoutEngine<never>,
    ],
  ]);
  const controllers = new Map<number, AbortController>();
  const runRequest: WorkerRequest = {
    kind: 'run',
    runId: 5,
    engineId: 'slow',
    graph: { nodes: [], edges: [] },
    options: {},
  };

  const running = handleWorkerRequest(runRequest, engines, () => {}, controllers);
  handleWorkerRequest({ kind: 'cancel', runId: 5 }, engines, () => {}, controllers);
  await running;

  expect(sawAbort).toBe(true);
});

it('cancel for an unknown runId is a no-op', async () => {
  await expect(
    handleWorkerRequest({ kind: 'cancel', runId: 999 }, BUILTIN_ENGINES, vi.fn(), new Map()),
  ).resolves.toBeUndefined();
});
