import type { GraphEditor } from '@graphloom/core';
import { deserialize } from './deserialize.js';
import { toEditor, type ToEditorOptions } from './hydrate.js';
import type { StorageAdapter } from './persisted-state.js';

/**
 * Loads {@link StorageAdapter.load}'s last saved state and hydrates a fresh
 * editor from it — `baseDocument` re-validated through {@link deserialize}
 * (storage can hold a stale format from an older app version, so it's
 * treated as untrusted the same as a file opened from disk) then replayed
 * forward through `operationLog` in one transaction. Returns `null` when
 * nothing has been saved yet, so the caller falls back to `createGraph()`.
 * A malformed `baseDocument` or a replay failure (e.g. an incompatible
 * command from a newer app version) rejects — recovery never returns a
 * half-loaded editor.
 */
export async function recoverEditor(
  adapter: StorageAdapter,
  options: ToEditorOptions = {},
): Promise<GraphEditor | null> {
  const persisted = await adapter.load();
  if (!persisted) return null;
  const document = deserialize(persisted.baseDocument);
  const editor = toEditor(document, options);
  editor.transact(() => {
    for (const command of persisted.operationLog) editor.execute(command);
  });
  return editor;
}
