import { expect, it } from 'vitest';
import { commands, createNode } from './builtins.js';
import { createGraph } from './editor.js';
import { CommandValidationError } from './errors.js';
import type { GraphPlugin } from './plugin.js';
import type { Node } from './types.js';

const noop = { type: 'test.noop', payload: {} };

/** Registers throwaway command types used to exercise bus contracts. */
const testCommands: GraphPlugin = {
  id: 'test-commands',
  version: '0.0.0',
  install(ctx) {
    ctx.commands.register('test.noop', {
      invert: () => noop,
      apply: () => {},
    });
    // The "atomic" failure pattern: throws before mutating anything.
    ctx.commands.register('test.boomAtomic', {
      invert: () => noop,
      apply: () => {
        throw new Error('boom');
      },
    });
    // The "compensate" failure pattern: mutates, fails, undoes its own work.
    ctx.commands.register<{ id: string }>('test.boomCompensate', {
      invert: () => noop,
      apply: (model, { id }) => {
        model.addNode(createNode({ id }));
        try {
          throw new Error('halfway failure');
        } catch (error) {
          model.removeNode(id); // compensation
          throw error;
        }
      },
    });
  },
};

it('rejects unknown command types with a typed error', () => {
  const editor = createGraph();
  expect(() => editor.execute({ type: 'nope', payload: {} })).toThrow(CommandValidationError);
});

it('a failing command mid-transaction rolls back all prior ops (P2-T04 acceptance)', () => {
  const editor = createGraph();
  editor.execute(commands.nodeAdd({ id: 'keep' }));
  const before = editor.snapshot();
  const changes: number[] = [];
  editor.on('graph.change', (e) => changes.push(e.operations.length));
  expect(() =>
    editor.transact(() => {
      editor.execute(commands.nodeAdd({ id: 'x' }));
      editor.execute(commands.edgeAdd({ id: 'e', source: 'x', target: 'keep' }));
      editor.execute(commands.nodeAdd({ id: 'x' })); // duplicate id → validation error
    }),
  ).toThrow(CommandValidationError);
  expect(editor.snapshot()).toEqual(before);
  expect(changes).toEqual([]); // rolled-back transactions emit nothing
});

it('a throwing apply leaves the model unchanged under both documented patterns', () => {
  const editor = createGraph();
  editor.use(testCommands);
  editor.execute(commands.nodeAdd({ id: 'base' }));
  const before = editor.snapshot();
  for (const type of ['test.boomAtomic', 'test.boomCompensate']) {
    expect(() =>
      editor.transact(() => {
        editor.execute(commands.nodeAdd({ id: 'temp' }));
        editor.execute({ type, payload: { id: 'partial' } });
      }),
    ).toThrow(/boom|halfway/);
    expect(editor.snapshot()).toEqual(before);
  }
});

it('nested transactions flatten into one atomic commit and one change event', () => {
  const editor = createGraph();
  const events: Array<readonly string[]> = [];
  editor.on('graph.change', (e) => events.push(e.operations.map((op) => op.command.type)));
  editor.transact(() => {
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.transact(() => {
      editor.execute(commands.nodeAdd({ id: 'b' }));
      editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    });
    editor.execute(commands.nodeUpdate('a', { zIndex: 1 }));
  });
  expect(events).toEqual([['node.add', 'node.add', 'edge.add', 'node.update']]);
});

it('a nested transaction failure aborts the outer transaction too', () => {
  const editor = createGraph();
  const before = editor.snapshot();
  expect(() =>
    editor.transact(() => {
      editor.execute(commands.nodeAdd({ id: 'a' }));
      editor.transact(() => {
        editor.execute(commands.nodeAdd({ id: 'a' })); // duplicate
      });
    }),
  ).toThrow(CommandValidationError);
  expect(editor.snapshot()).toEqual(before);
});

it('empty transactions emit no change event', () => {
  const editor = createGraph();
  let calls = 0;
  editor.on('graph.change', () => calls++);
  editor.transact(() => {});
  expect(calls).toBe(0);
});

it('granular events fire before graph.change, per commit', () => {
  const editor = createGraph();
  const order: string[] = [];
  editor.on('node.created', ({ node }) => order.push(`created:${node.id}`));
  editor.on('graph.change', ({ operations }) => order.push(`change:${operations.length}`));
  editor.transact(() => {
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b' }));
  });
  expect(order).toEqual(['created:a', 'created:b', 'change:2']);
});

it('is reentrancy-safe: commands dispatched from handlers defer until the flush ends', () => {
  const editor = createGraph();
  const order: string[] = [];
  editor.on('node.created', ({ node }) => {
    order.push(`created:${node.id}`);
    if (node.id === 'a') editor.execute(commands.nodeAdd({ id: 'b' }));
  });
  editor.on('graph.change', ({ operations }) => {
    const node = (operations[0]!.command.payload as { node: Node }).node;
    order.push(`change:${node.id}`);
  });
  editor.execute(commands.nodeAdd({ id: 'a' }));
  expect(order).toEqual(['created:a', 'change:a', 'created:b', 'change:b']);
  expect(editor.graph.nodeCount).toBe(2);
});

it('transactions dispatched from handlers defer as a unit', () => {
  const editor = createGraph();
  const changes: string[][] = [];
  editor.on('graph.change', ({ operations }) =>
    changes.push(operations.map((op) => op.command.type)),
  );
  const off = editor.on('node.created', ({ node }) => {
    if (node.id !== 'a') return;
    editor.transact(() => {
      editor.execute(commands.nodeAdd({ id: 'b' }));
      editor.execute(commands.nodeAdd({ id: 'c' }));
    });
  });
  editor.execute(commands.nodeAdd({ id: 'a' }));
  off();
  expect(changes).toEqual([['node.add'], ['node.add', 'node.add']]);
});

it('records exact inverses on the change event (ADR-0001 history unit)', () => {
  const editor = createGraph();
  let inverseType = '';
  editor.on('graph.change', ({ operations }) => {
    inverseType = operations[0]!.inverse.type;
  });
  editor.execute(commands.nodeAdd({ id: 'a' }));
  expect(inverseType).toBe('node.remove');
  editor.execute(commands.nodeRemove('a'));
  expect(inverseType).toBe('node.restore');
});
