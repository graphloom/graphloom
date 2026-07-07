import { expect, it } from 'vitest';
import { commands } from './builtins.js';
import { DEFAULT_LIMITS } from './command.js';
import { createGraph } from './editor.js';
import { LimitExceededError } from './errors.js';

it('exposes limits at runtime, merged over the ADR-0007 defaults', () => {
  expect(createGraph().limits).toEqual(DEFAULT_LIMITS);
  const editor = createGraph({ limits: { maxNodes: 10 } });
  expect(editor.limits).toEqual({ maxNodes: 10, maxEdges: 2000, warnAtRatio: 0.8 });
});

it('rejects a command crossing maxNodes atomically, with a typed error and event', () => {
  const editor = createGraph({ limits: { maxNodes: 1 } });
  const exceeded: unknown[] = [];
  editor.on('limit.exceeded', (e) => exceeded.push(e));
  editor.execute(commands.nodeAdd({ id: 'a' }));
  let caught: LimitExceededError | undefined;
  try {
    editor.execute(commands.nodeAdd({ id: 'b' }));
  } catch (error) {
    caught = error as LimitExceededError;
  }
  expect(caught).toBeInstanceOf(LimitExceededError);
  expect(caught).toMatchObject({ limit: 'maxNodes', attempted: 2, max: 1 });
  expect(exceeded).toEqual([{ limit: 'maxNodes', attempted: 2, max: 1 }]);
  expect(editor.graph.nodeCount).toBe(1);
  expect(editor.graph.getNode('b')).toBeUndefined();
});

it('rejects a transaction crossing a limit atomically — the model is untouched', () => {
  const editor = createGraph({ limits: { maxNodes: 3 } });
  editor.execute(commands.nodeAdd({ id: 'a' }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  const before = editor.snapshot();
  expect(() =>
    editor.transact(() => {
      editor.execute(commands.nodeAdd({ id: 'c' })); // still within the limit
      editor.execute(commands.nodeAdd({ id: 'd' })); // crosses it → whole tx dies
    }),
  ).toThrow(LimitExceededError);
  expect(editor.snapshot()).toEqual(before);
});

it('enforces maxEdges too', () => {
  const editor = createGraph({ limits: { maxEdges: 1 } });
  editor.execute(commands.nodeAdd({ id: 'a' }));
  editor.execute(commands.edgeAdd({ id: 'e1', source: 'a', target: 'a' }));
  expect(() => editor.execute(commands.edgeAdd({ id: 'e2', source: 'a', target: 'a' }))).toThrow(
    LimitExceededError,
  );
  expect(editor.graph.edgeCount).toBe(1);
});

it('fires limit.warning exactly once per crossing of warnAtRatio (ADR-0007)', () => {
  const editor = createGraph({ limits: { maxNodes: 10 } }); // warns at 8
  const warnings: unknown[] = [];
  editor.on('limit.warning', (e) => warnings.push(e));
  for (let i = 0; i < 8; i++) editor.execute(commands.nodeAdd({ id: `n${i}` }));
  expect(warnings).toEqual([{ limit: 'maxNodes', count: 8, max: 10 }]);
  editor.execute(commands.nodeAdd({ id: 'n8' })); // still above: no re-fire
  expect(warnings).toHaveLength(1);
  editor.execute(commands.nodeRemove('n8'));
  editor.execute(commands.nodeRemove('n7')); // drops below the threshold: re-arms
  editor.execute(commands.nodeAdd({ id: 'n7' })); // crosses again
  expect(warnings).toHaveLength(2);
});

it('Infinity opts a limit out entirely', () => {
  const editor = createGraph({ limits: { maxNodes: Infinity, maxEdges: Infinity } });
  const events: unknown[] = [];
  editor.on('limit.warning', (e) => events.push(e));
  editor.on('limit.exceeded', (e) => events.push(e));
  editor.transact(() => {
    for (let i = 0; i < 600; i++) editor.execute(commands.nodeAdd({ id: `n${i}` }));
  });
  expect(editor.graph.nodeCount).toBe(600);
  expect(events).toEqual([]);
});

it('history replays bypass limit checks (documented undo policy, P2-T07)', () => {
  const editor = createGraph({ limits: { maxNodes: 2 } });
  editor.execute(commands.nodeAdd({ id: 'a' }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  // e.g. undoing a delete while already back at the limit
  editor.execute(commands.nodeAdd({ id: 'c' }), { source: 'history' });
  expect(editor.graph.nodeCount).toBe(3);
});
