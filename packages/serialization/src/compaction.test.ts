// P10-T05 acceptance: "compaction produces a document equal to replaying the
// log (property test)". Compaction (baseDocument := current document,
// operationLog := []) must be invisible to the final result — for ANY random
// command sequence, compacting at ANY point and continuing must reach the
// same state as never compacting at all. Mirrors the random-command-sequence
// technique already established for the P3-T01 scene-graph property test
// (rendering/scene.test.ts): op descriptors reference elements by an
// abstract index resolved against live model state, so every generated
// sequence is valid by construction.
import { commands, createGraph, type Command, type GraphEditor } from '@graphloom/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { toEditor } from './hydrate.js';
import { toDocument } from './serialize.js';

const opArb = fc.oneof(
  fc.record({
    op: fc.constant('addNode' as const),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
    label: fc.option(fc.string({ maxLength: 12 }), { nil: undefined }),
  }),
  fc.record({
    op: fc.constant('updateNode' as const),
    pick: fc.nat(),
    x: fc.integer({ min: -500, max: 500 }),
    y: fc.integer({ min: -500, max: 500 }),
  }),
  fc.record({ op: fc.constant('removeNode' as const), pick: fc.nat() }),
  fc.record({
    op: fc.constant('addEdge' as const),
    pickA: fc.nat(),
    pickB: fc.nat(),
  }),
  fc.record({ op: fc.constant('removeEdge' as const), pick: fc.nat() }),
);
type Op = typeof opArb extends fc.Arbitrary<infer T> ? T : never;

const pickFrom = <T>(list: readonly T[], index: number): T | undefined =>
  list.length === 0 ? undefined : list[index % list.length];

/** Runs `ops` against a fresh editor, returning the concrete commands actually applied. */
function materialize(ops: readonly Op[]): Command[] {
  const editor = createGraph();
  const log: Command[] = [];
  const unsubscribe = editor.on('graph.change', ({ operations }) => {
    log.push(...operations.map((o) => o.command));
  });
  let nextId = 0;
  for (const op of ops) {
    const nodes = editor.graph.nodes();
    const edges = editor.graph.edges();
    switch (op.op) {
      case 'addNode':
        editor.execute(
          commands.nodeAdd({
            id: `n${nextId++}`,
            position: { x: op.x, y: op.y },
            data: op.label === undefined ? {} : { label: op.label },
          }),
        );
        break;
      case 'updateNode': {
        const node = pickFrom(nodes, op.pick);
        if (node) editor.execute(commands.nodeUpdate(node.id, { position: { x: op.x, y: op.y } }));
        break;
      }
      case 'removeNode': {
        const node = pickFrom(nodes, op.pick);
        if (node) editor.execute(commands.nodeRemove(node.id));
        break;
      }
      case 'addEdge': {
        const source = pickFrom(nodes, op.pickA);
        const target = pickFrom(nodes, op.pickB);
        if (source && target) {
          editor.execute(commands.edgeAdd({ id: `e${nextId++}`, source: source.id, target: target.id }));
        }
        break;
      }
      case 'removeEdge': {
        const edge = pickFrom(edges, op.pick);
        if (edge) editor.execute(commands.edgeRemove(edge.id));
        break;
      }
    }
  }
  unsubscribe();
  return log;
}

// Fixed so every editor in a single property run shares one identity — the
// property is about graph *content* surviving compaction, not about two
// independently-created editors coincidentally getting the same random id.
const META = { id: 'compaction-test', name: 'x', createdAt: '2026-01-01T00:00:00.000Z', modifiedAt: '2026-01-01T00:00:00.000Z' };

const replay = (commandLog: readonly Command[]): GraphEditor => {
  const editor = createGraph({ meta: META });
  for (const command of commandLog) editor.execute(command);
  return editor;
};

describe('compaction', () => {
  it('compacting at any point and continuing reaches the same state as never compacting', () => {
    fc.assert(
      fc.property(
        fc.array(opArb, { minLength: 2, maxLength: 30 }),
        fc.nat(),
        (ops, splitSeed) => {
          const commandLog = materialize(ops);
          fc.pre(commandLog.length >= 2);
          const splitAt = 1 + (splitSeed % (commandLog.length - 1)); // never 0 or the full length

          const never = replay(commandLog);
          const expected = toDocument(never);

          // "Compact" at splitAt: collapse everything so far into a document,
          // discard the log, then keep going from that document.
          const before = replay(commandLog.slice(0, splitAt));
          const compactedBase = toDocument(before);
          const resumed = toEditor(compactedBase);
          for (const command of commandLog.slice(splitAt)) resumed.execute(command);

          expect(toDocument(resumed)).toEqual(expected);
        },
      ),
      { numRuns: 200 },
    );
  });
});
