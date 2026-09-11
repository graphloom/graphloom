export {
  DEFAULT_GENERATOR,
  DEFAULT_VIEWPORT,
  FORMAT_VERSION,
  SerializationError,
  type DocumentExtras,
  type GraphDocument,
} from './document.js';
export { serialize, serializeDocument, toDocument } from './serialize.js';
export { deserialize } from './deserialize.js';
export { toEditor, type ToEditorOptions } from './hydrate.js';
export type { PersistedState, StorageAdapter } from './persisted-state.js';
export {
  createAutosave,
  type Autosave,
  type AutosaveEventMap,
  type AutosaveOptions,
} from './autosave.js';
export { recoverEditor } from './recover.js';

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/serialization';
