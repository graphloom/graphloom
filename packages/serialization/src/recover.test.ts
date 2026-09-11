import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { createAutosave } from './autosave.js';
import { SerializationError } from './document.js';
import type { PersistedState, StorageAdapter } from './persisted-state.js';
import { recoverEditor } from './recover.js';
import { toDocument } from './serialize.js';

const memoryAdapter = (initial: PersistedState | null = null): StorageAdapter => {
  let state = initial;
  return {
    async load() {
      return state;
    },
    async save(next) {
      state = next;
    },
  };
};

describe('recoverEditor', () => {
  it('returns null when nothing has been saved yet', async () => {
    await expect(recoverEditor(memoryAdapter())).resolves.toBeNull();
  });

  it('hydrates an editor from a bare baseDocument (empty op-log)', async () => {
    const seed = createGraph();
    seed.execute(commands.nodeAdd({ id: 'a', position: { x: 1, y: 2 }, data: { label: 'A' } }));
    const adapter = memoryAdapter({ baseDocument: toDocument(seed), operationLog: [] });

    const editor = await recoverEditor(adapter);
    expect(editor!.graph.getNode('a')?.data).toEqual({ label: 'A' });
  });

  it('replays operationLog on top of baseDocument', async () => {
    const seed = createGraph();
    seed.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 } }));
    const adapter = memoryAdapter({
      baseDocument: toDocument(seed),
      operationLog: [
        commands.nodeUpdate('a', { position: { x: 9, y: 9 } }),
        commands.nodeAdd({ id: 'b', position: { x: 5, y: 5 } }),
      ],
    });

    const editor = await recoverEditor(adapter);
    expect(editor!.graph.getNode('a')?.position).toEqual({ x: 9, y: 9 });
    expect(editor!.graph.getNode('b')).toBeDefined();
  });

  it('rejects on a malformed baseDocument rather than returning a half-loaded editor', async () => {
    const adapter = memoryAdapter({
      // @ts-expect-error deliberately malformed for the test
      baseDocument: { graphloom: '1.0' },
      operationLog: [],
    });
    await expect(recoverEditor(adapter)).rejects.toThrow(SerializationError);
  });

  it('rejects when a logged command no longer applies (e.g. a stale reference)', async () => {
    const seed = createGraph();
    const adapter = memoryAdapter({
      baseDocument: toDocument(seed),
      operationLog: [commands.nodeUpdate('missing', { position: { x: 0, y: 0 } })],
    });
    await expect(recoverEditor(adapter)).rejects.toThrow();
  });

  it('passes options through to the underlying hydration (e.g. limits)', async () => {
    const seed = createGraph();
    seed.transact(() => {
      seed.execute(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 } }));
      seed.execute(commands.nodeAdd({ id: 'b', position: { x: 0, y: 0 } }));
    });
    const adapter = memoryAdapter({ baseDocument: toDocument(seed), operationLog: [] });
    await expect(recoverEditor(adapter, { limits: { maxNodes: 1 } })).rejects.toThrow();
  });

  it('kill-and-reload: recovers to the exact state as of the last flush (the acceptance)', async () => {
    const adapter = memoryAdapter();
    const live: GraphEditor = createGraph();
    const autosave = createAutosave(live, adapter);
    live.transact(() => {
      live.execute(commands.nodeAdd({ id: 'a', position: { x: 1, y: 1 }, data: { label: 'A' } }));
      live.execute(commands.nodeAdd({ id: 'b', position: { x: 2, y: 2 } }));
    });
    live.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    await autosave.flush(); // the last op before "kill"
    autosave.dispose();

    // "reload" — a brand new editor recovered from the same storage.
    const recovered = await recoverEditor(adapter);
    expect(toDocument(recovered!)).toEqual(toDocument(live));
  });
});
