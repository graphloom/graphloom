import { expect, it, vi } from 'vitest';
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { createHistory, type History } from '@graphloom/history';
import type { LayoutEngine, LayoutGraph } from './contract.js';
import { createLayoutRunner, type LayoutRunner } from './runner.js';

const meta = { id: 'doc', name: 'test', createdAt: 't0', modifiedAt: 't0' };

function setup(): { editor: GraphEditor; history: History; runner: LayoutRunner } {
  const editor = createGraph({ meta });
  const history = createHistory(editor);
  const runner = createLayoutRunner(editor);
  return { editor, history, runner };
}

// Positions are node centers (contract.ts); the default node size (100x40)
// created by commands.nodeAdd means center {0,0} lands at top-left {-50,-20}.
function grid(): LayoutEngine<void> {
  return {
    id: 'grid',
    async compute(graph) {
      const positions = new Map(graph.nodes.map((node, i) => [node.id, { x: i * 10, y: 0 }]));
      return { positions };
    },
  };
}

interface Deferred<T> {
  readonly promise: Promise<T>;
  resolve(value: T): void;
  reject(error: unknown): void;
}

function defer<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

it('applies computed positions as one undoable transaction', async () => {
  const { editor, history, runner } = setup();
  editor.transact(() => {
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b' }));
  });

  const applied = await runner.run(grid(), { options: undefined });

  expect(applied).toBe(true);
  expect(editor.graph.getNode('a')?.position).toEqual({ x: -50, y: -20 });
  expect(editor.graph.getNode('b')?.position).toEqual({ x: -40, y: -20 });
  expect(history.canUndo).toBe(true);
  expect(history.undo()).toBe(true); // undoes the layout — one entry
  expect(editor.graph.getNode('a')?.position).toEqual({ x: 0, y: 0 });
  expect(editor.graph.getNode('b')?.position).toEqual({ x: 0, y: 0 });
  expect(history.undo()).toBe(true); // undoes the node adds — the other entry
  expect(editor.graph.getNode('a')).toBeUndefined();
  expect(history.undo()).toBe(false); // nothing left
});

it('emits layout.completed with the engine id once positions are applied', async () => {
  const { editor, runner } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  const completed = vi.fn();
  runner.on('layout.completed', completed);

  await runner.run(grid(), { options: undefined });

  expect(completed).toHaveBeenCalledWith({ layout: 'grid' });
});

it('forwards engine progress reports', async () => {
  const { editor, runner } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  const progress = vi.fn();
  runner.on('layout.progress', progress);
  const engine: LayoutEngine<void> = {
    id: 'progressive',
    async compute(graph, _options, ctx) {
      ctx.reportProgress(0.5);
      return { positions: new Map(graph.nodes.map((n) => [n.id, { x: 1, y: 1 }])) };
    },
  };

  await runner.run(engine, { options: undefined });

  expect(progress).toHaveBeenCalledWith({ layout: 'progressive', ratio: 0.5 });
});

it('scopes the snapshot to the requested node ids and only includes edges between them', async () => {
  const { editor, runner } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  editor.execute(commands.nodeAdd({ id: 'c' }));
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  editor.execute(commands.edgeAdd({ id: 'bc', source: 'b', target: 'c' }));

  let seen: LayoutGraph | undefined;
  const engine: LayoutEngine<void> = {
    id: 'capture',
    async compute(graph) {
      seen = graph;
      return { positions: new Map() };
    },
  };

  await runner.run(engine, { options: undefined, nodeIds: ['a', 'b'] });

  expect(seen?.nodes.map((n) => n.id).sort()).toEqual(['a', 'b']);
  expect(seen?.edges.map((e) => e.id)).toEqual(['ab']);
});

it('propagates an engine failure when the run was not cancelled', async () => {
  const { runner } = setup();
  const boom = new Error('boom');
  const engine: LayoutEngine<void> = {
    id: 'broken',
    async compute() {
      throw boom;
    },
  };

  await expect(runner.run(engine, { options: undefined })).rejects.toThrow(boom);
});

it('resolves false instead of throwing when a cancelled run rejects', async () => {
  const { runner } = setup();
  const gate = defer<void>();
  const engine: LayoutEngine<void> = {
    id: 'cancels-with-error',
    async compute() {
      await gate.promise;
      throw new Error('should be swallowed');
    },
  };

  const run = runner.run(engine, { options: undefined });
  runner.cancel();
  gate.resolve();

  await expect(run).resolves.toBe(false);
});

it('resolves false and leaves the model untouched when cancelled before the engine settles', async () => {
  const { editor, runner } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  const before = editor.graph.getNode('a')!.position;
  const gate = defer<void>();
  const engine: LayoutEngine<void> = {
    id: 'slow',
    async compute(graph) {
      await gate.promise;
      return { positions: new Map(graph.nodes.map((n) => [n.id, { x: 99, y: 99 }])) };
    },
  };

  const run = runner.run(engine, { options: undefined });
  expect(runner.running).toBe(true);
  runner.cancel();
  gate.resolve();
  const applied = await run;

  expect(applied).toBe(false);
  expect(editor.graph.getNode('a')?.position).toEqual(before);
  expect(runner.running).toBe(false);
});

it('cancels an in-flight run when a new one starts — only one run at a time', async () => {
  const { editor, runner } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  const gate = defer<void>();
  const stale: LayoutEngine<void> = {
    id: 'stale',
    async compute(graph) {
      await gate.promise;
      return { positions: new Map(graph.nodes.map((n) => [n.id, { x: -1, y: -1 }])) };
    },
  };

  const first = runner.run(stale, { options: undefined });
  const second = runner.run(grid(), { options: undefined });
  gate.resolve();
  const [firstApplied, secondApplied] = await Promise.all([first, second]);

  expect(firstApplied).toBe(false);
  expect(secondApplied).toBe(true);
  expect(editor.graph.getNode('a')?.position).toEqual({ x: -50, y: -20 }); // grid's result, not stale's
});

it('skips no-op updates so an unchanged layout does not create a history entry', async () => {
  const { editor, history, runner } = setup();
  editor.execute(commands.nodeAdd({ id: 'a', position: { x: 5, y: 5 } }));
  const identity: LayoutEngine<void> = {
    id: 'identity',
    async compute(graph) {
      // Echo each node's current center — should round-trip to a no-op.
      const positions = new Map(
        graph.nodes.map((n) => [
          n.id,
          { x: n.position.x + n.size.width / 2, y: n.position.y + n.size.height / 2 },
        ]),
      );
      return { positions };
    },
  };

  const before = history.canUndo;
  await runner.run(identity, { options: undefined });

  expect(history.canUndo).toBe(before);
});
