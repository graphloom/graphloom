import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createAutosave } from './autosave.js';
import type { PersistedState, StorageAdapter } from './persisted-state.js';

const memoryAdapter = (): StorageAdapter & { saves: PersistedState[] } => {
  let state: PersistedState | null = null;
  const saves: PersistedState[] = [];
  return {
    saves,
    async load() {
      return state;
    },
    async save(next) {
      state = next;
      saves.push(next);
    },
  };
};

const addNode = (editor: GraphEditor, id: string): void => {
  editor.execute(commands.nodeAdd({ id, position: { x: 0, y: 0 } }));
};

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('createAutosave', () => {
  it('starts clean: not dirty, no save until something changes', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter);
    expect(autosave.dirty).toBe(false);
    await vi.advanceTimersByTimeAsync(10_000);
    expect(adapter.saves).toHaveLength(0);
    autosave.dispose();
  });

  it('marks dirty on a model change and emits autosave.dirty exactly once', () => {
    const editor = createGraph();
    const autosave = createAutosave(editor, memoryAdapter());
    const dirtyEvents: unknown[] = [];
    autosave.on('autosave.dirty', (e) => dirtyEvents.push(e));

    addNode(editor, 'a');
    expect(autosave.dirty).toBe(true);
    addNode(editor, 'b'); // still dirty — must not re-fire
    expect(dirtyEvents).toHaveLength(1);
    autosave.dispose();
  });

  it('saves after the debounce goes quiet, with every accumulated operation', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter, { debounceMs: 500 });
    const saved: PersistedState[] = [];
    autosave.on('autosave.saved', (e) => saved.push(e.state));

    addNode(editor, 'a');
    await vi.advanceTimersByTimeAsync(499);
    expect(adapter.saves).toHaveLength(0); // not yet — debounce hasn't elapsed

    await vi.advanceTimersByTimeAsync(1);
    expect(adapter.saves).toHaveLength(1);
    expect(adapter.saves[0]!.operationLog).toHaveLength(1);
    expect(adapter.saves[0]!.operationLog[0]).toEqual(commands.nodeAdd({ id: 'a', position: { x: 0, y: 0 } }));
    expect(saved).toHaveLength(1);
    expect(autosave.dirty).toBe(false);
    autosave.dispose();
  });

  it('resets the debounce on every change — one save for a whole burst', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter, { debounceMs: 500 });

    addNode(editor, 'a');
    await vi.advanceTimersByTimeAsync(300);
    addNode(editor, 'b'); // resets the timer
    await vi.advanceTimersByTimeAsync(300);
    expect(adapter.saves).toHaveLength(0); // 600ms since 'a', but only 300ms since 'b'

    await vi.advanceTimersByTimeAsync(200);
    expect(adapter.saves).toHaveLength(1);
    expect(adapter.saves[0]!.operationLog).toHaveLength(2);
    autosave.dispose();
  });

  it('flush() saves immediately, bypassing the debounce timer', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter, { debounceMs: 10_000 });

    addNode(editor, 'a');
    await autosave.flush();
    expect(adapter.saves).toHaveLength(1);
    expect(autosave.dirty).toBe(false);

    await vi.advanceTimersByTimeAsync(20_000);
    expect(adapter.saves).toHaveLength(1); // the (now cancelled) timer never also fires
    autosave.dispose();
  });

  it('flush() on a clean autosave is a no-op', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter);
    await autosave.flush();
    expect(adapter.saves).toHaveLength(0);
    autosave.dispose();
  });

  it('compacts once the op-log passes compactAfter: base becomes current state, log clears', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter, { debounceMs: 100, compactAfter: 2 });

    addNode(editor, 'a');
    addNode(editor, 'b');
    addNode(editor, 'c'); // 3 ops > compactAfter 2
    await vi.advanceTimersByTimeAsync(100);

    expect(adapter.saves).toHaveLength(1);
    const saved = adapter.saves[0]!;
    expect(saved.operationLog).toHaveLength(0);
    expect(saved.baseDocument.graph.nodes.map((n) => n.id)).toEqual(['a', 'b', 'c']);
    autosave.dispose();
  });

  it('reports a failed save via autosave.error without throwing out of the debounce path', async () => {
    const editor = createGraph();
    const adapter: StorageAdapter = {
      load: async () => null,
      save: async () => {
        throw new Error('disk full');
      },
    };
    const autosave = createAutosave(editor, adapter, { debounceMs: 100 });
    const errors: unknown[] = [];
    autosave.on('autosave.error', (e) => errors.push(e.error));

    addNode(editor, 'a');
    await vi.advanceTimersByTimeAsync(100);
    expect(errors).toHaveLength(1);
    expect((errors[0] as Error).message).toBe('disk full');
    autosave.dispose();
  });

  it('flush() propagates a save failure to its caller', async () => {
    const editor = createGraph();
    const adapter: StorageAdapter = {
      load: async () => null,
      save: async () => {
        throw new Error('disk full');
      },
    };
    const autosave = createAutosave(editor, adapter);
    addNode(editor, 'a');
    await expect(autosave.flush()).rejects.toThrow('disk full');
    autosave.dispose();
  });

  it('dispose() stops watching the editor and cancels a pending save', async () => {
    const editor = createGraph();
    const adapter = memoryAdapter();
    const autosave = createAutosave(editor, adapter, { debounceMs: 100 });

    addNode(editor, 'a');
    autosave.dispose();
    await vi.advanceTimersByTimeAsync(1000);
    expect(adapter.saves).toHaveLength(0);

    // A no-longer-watched editor changing further leaves autosave's state
    // exactly as dispose() found it (still dirty from 'a' — disposing isn't
    // saving) rather than reacting.
    const dirtyAtDispose = autosave.dirty;
    addNode(editor, 'b');
    expect(autosave.dirty).toBe(dirtyAtDispose);
  });

  it('dispose() is idempotent', () => {
    const autosave = createAutosave(createGraph(), memoryAdapter());
    autosave.dispose();
    expect(() => autosave.dispose()).not.toThrow();
  });
});
