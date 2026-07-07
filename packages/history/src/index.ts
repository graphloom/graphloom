import {
  Emitter,
  type AppliedOperation,
  type Command,
  type ExecuteOptions,
  type GraphEventMap,
  type Unsubscribe,
} from '@graphloom/core';

/** Options for {@link createHistory}. */
export interface HistoryOptions {
  /** Maximum undo entries kept; oldest are evicted beyond it. Default 100. */
  readonly depth?: number;
}

/** Events emitted by a {@link History} instance. */
export interface HistoryEventMap {
  /** Fires whenever the undo/redo stacks change (ADR-0001 canUndo/canRedo signals). */
  'history.changed': { readonly canUndo: boolean; readonly canRedo: boolean };
}

/**
 * The slice of a `GraphEditor` history needs — kept structural so the service
 * works with anything that exposes the core command/event surface.
 */
export interface HistoryEditor {
  /** Subscribes to editor events. */
  on<K extends keyof GraphEventMap>(
    type: K,
    handler: (payload: GraphEventMap[K]) => void,
  ): Unsubscribe;
  /** Executes a command. */
  execute(command: Command, options?: ExecuteOptions): void;
  /** Runs an atomic transaction. */
  transact(fn: () => void, options?: ExecuteOptions): void;
}

/**
 * Undo/redo service (ADR-0001): stacks of `{command, inverse}` pairs recorded
 * from the editor's `graph.change` stream — never model snapshots. Replays
 * run with source `history`, which bypasses validation and limit checks
 * (tracker P2-T07 policy) and keeps replays from re-recording themselves.
 */
export interface History {
  /** Whether {@link History.undo} would do anything. */
  readonly canUndo: boolean;
  /** Whether {@link History.redo} would do anything. */
  readonly canRedo: boolean;
  /** Reverts the newest history entry. Returns false when there is nothing to undo. */
  undo(): boolean;
  /** Re-applies the newest undone entry. Returns false when there is nothing to redo. */
  redo(): boolean;
  /** Empties both stacks (clear-on-load semantics — call after loading a document). */
  clear(): void;
  /** Unsubscribes from the editor; the instance is dead afterwards. */
  dispose(): void;
  /** Subscribes to {@link HistoryEventMap} events. */
  on<K extends keyof HistoryEventMap>(
    type: K,
    handler: (payload: HistoryEventMap[K]) => void,
  ): Unsubscribe;
}

interface Entry {
  ops: AppliedOperation[];
  coalesceKey: string | undefined;
}

/**
 * Attaches an undo/redo service to an editor. Every non-`history` commit
 * becomes one history entry; consecutive commits sharing a `coalesceKey`
 * (e.g. label typing) merge into one entry until interrupted.
 */
export function createHistory(editor: HistoryEditor, options: HistoryOptions = {}): History {
  const depth = options.depth ?? 100;
  const emitter = new Emitter<HistoryEventMap>();
  let undoStack: Entry[] = [];
  let redoStack: Entry[] = [];

  const notify = (): void => {
    emitter.emit('history.changed', {
      canUndo: undoStack.length > 0,
      canRedo: redoStack.length > 0,
    });
  };

  const unsubscribe = editor.on('graph.change', ({ operations, source, coalesceKey }) => {
    if (source === 'history') return;
    const last = undoStack[undoStack.length - 1];
    if (coalesceKey !== undefined && last?.coalesceKey === coalesceKey && redoStack.length === 0) {
      last.ops.push(...operations);
    } else {
      redoStack = []; // a new user command invalidates the redo branch
      undoStack.push({ ops: [...operations], coalesceKey });
      if (undoStack.length > depth) undoStack.shift();
    }
    notify();
  });

  return {
    get canUndo() {
      return undoStack.length > 0;
    },
    get canRedo() {
      return redoStack.length > 0;
    },
    undo() {
      const entry = undoStack.pop();
      if (!entry) return false;
      editor.transact(
        () => {
          for (let i = entry.ops.length - 1; i >= 0; i--) {
            editor.execute(entry.ops[i]!.inverse, { source: 'history' });
          }
        },
        { source: 'history' },
      );
      redoStack.push(entry);
      notify();
      return true;
    },
    redo() {
      const entry = redoStack.pop();
      if (!entry) return false;
      editor.transact(
        () => {
          for (const op of entry.ops) {
            editor.execute(op.command, { source: 'history' });
          }
        },
        { source: 'history' },
      );
      undoStack.push(entry);
      notify();
      return true;
    },
    clear() {
      undoStack = [];
      redoStack = [];
      notify();
    },
    dispose() {
      unsubscribe();
    },
    on: (type, handler) => emitter.on(type, handler),
  };
}
