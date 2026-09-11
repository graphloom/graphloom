import type { Command } from '@graphloom/core';
import type { GraphDocument } from './document.js';

/**
 * Incremental autosave state (ADR-0004): a full document plus the commands
 * applied on top of it. Replaying `operationLog` against `baseDocument`
 * reconstructs the exact current state — cheaper to persist on every change
 * than re-serializing the whole graph, and `{@link createAutosave}` collapses
 * it back to a bare document (`operationLog: []`) once the log grows long.
 */
export interface PersistedState {
  readonly baseDocument: GraphDocument;
  readonly operationLog: readonly Command[];
}

/**
 * Storage backend for autosave, supplied by the host (spec §Enterprise
 * Features: localStorage, IndexedDB, HTTP, …). Dealing in structured
 * {@link PersistedState} rather than bytes keeps the interface backend-
 * agnostic — an adapter owns whatever text/binary encoding its backend needs
 * (e.g. `JSON.stringify` for `localStorage`).
 */
export interface StorageAdapter {
  /** Returns the last persisted state, or `null` if nothing has been saved yet. */
  load(): Promise<PersistedState | null>;
  /** Persists `state`, replacing whatever was saved before. */
  save(state: PersistedState): Promise<void>;
}
