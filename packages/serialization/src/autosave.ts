import { Emitter, type Command, type GraphEditor, type Unsubscribe } from '@graphloom/core';
import type { DocumentExtras } from './document.js';
import type { PersistedState, StorageAdapter } from './persisted-state.js';
import { toDocument } from './serialize.js';

/** Options for {@link createAutosave}. */
export interface AutosaveOptions {
  /** Idle time after the last change before saving. Default 1000ms. */
  readonly debounceMs?: number;
  /**
   * Op-log length past which the next save compacts (`baseDocument` becomes
   * the current document, `operationLog` clears) instead of appending.
   * Default 200.
   */
  readonly compactAfter?: number;
  /** Viewport/extensions/generator to stamp onto a compacted `baseDocument`. */
  readonly extras?: DocumentExtras;
}

/** Events emitted by {@link Autosave}. */
export interface AutosaveEventMap {
  /** Fires once when a clean autosave becomes dirty (not on every subsequent change). */
  'autosave.dirty': Record<string, never>;
  /** A save (debounced or via {@link Autosave.flush}) has started. */
  'autosave.saving': Record<string, never>;
  /** A save completed successfully. */
  'autosave.saved': { readonly state: PersistedState };
  /** A save rejected. The debounce path reports this instead of throwing; {@link Autosave.flush} also rejects. */
  'autosave.error': { readonly error: unknown };
}

/**
 * An autosave watching one editor. Debounces `graph.change` into periodic
 * {@link StorageAdapter.save} calls, self-compacting the op-log once it
 * grows past `compactAfter` (ADR-0004: "a full save compacts to a plain
 * document").
 */
export interface Autosave {
  /** Whether there are changes not yet reflected in the last successful save. */
  readonly dirty: boolean;
  /** Subscribes to an {@link AutosaveEventMap} event; returns an unsubscriber. */
  on<K extends keyof AutosaveEventMap>(
    type: K,
    handler: (payload: AutosaveEventMap[K]) => void,
  ): Unsubscribe;
  /** Saves immediately, cancelling any pending debounce timer. A no-op (resolves immediately) when not dirty. */
  flush(): Promise<void>;
  /** Stops watching the editor and cancels any pending save. */
  dispose(): void;
}

/**
 * Wires autosave onto `editor`: every `graph.change` (regardless of source —
 * a replayed inverse from undo is still a real state change worth
 * persisting) appends its commands to an in-memory op-log and (re)starts the
 * debounce timer. `baseDocument` is captured once at creation from the
 * editor's current state — a freshly created editor or one already hydrated
 * by {@link recoverEditor} both just mean "start persisting from here."
 */
export function createAutosave(
  editor: GraphEditor,
  adapter: StorageAdapter,
  options: AutosaveOptions = {},
): Autosave {
  const debounceMs = options.debounceMs ?? 1000;
  const compactAfter = options.compactAfter ?? 200;
  const emitter = new Emitter<AutosaveEventMap>();

  let baseDocument = toDocument(editor, options.extras);
  let operationLog: Command[] = [];
  let dirty = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let disposed = false;

  const clearTimer = (): void => {
    if (timer !== null) {
      clearTimeout(timer);
      timer = null;
    }
  };

  const save = async (): Promise<void> => {
    clearTimer();
    if (!dirty) return;
    if (operationLog.length > compactAfter) {
      baseDocument = toDocument(editor, options.extras);
      operationLog = [];
    }
    const state: PersistedState = { baseDocument, operationLog: [...operationLog] };
    emitter.emit('autosave.saving', {});
    try {
      await adapter.save(state);
      dirty = false;
      emitter.emit('autosave.saved', { state });
    } catch (error) {
      emitter.emit('autosave.error', { error });
      throw error;
    }
  };

  const unsubscribe = editor.on('graph.change', ({ operations }) => {
    operationLog.push(...operations.map((op) => op.command));
    if (!dirty) {
      dirty = true;
      emitter.emit('autosave.dirty', {});
    }
    clearTimer();
    timer = setTimeout(() => {
      timer = null;
      // Rejections are reported via 'autosave.error'; nothing here awaits
      // this promise, so an unhandled rejection would otherwise surface.
      void save().catch(() => {});
    }, debounceMs);
  });

  return {
    get dirty() {
      return dirty;
    },
    on: (type, handler) => emitter.on(type, handler),
    flush: () => save(),
    dispose() {
      if (disposed) return;
      disposed = true;
      unsubscribe();
      clearTimer();
    },
  };
}
