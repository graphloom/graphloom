'use client';
// ^ RSC boundary (P6-T04): the whole package is client code; importing it
// from a Server Component tree is legal and flips to the client at this line.
export {
  Graph,
  GraphContext,
  type GraphEventProps,
  type GraphHandle,
  type GraphOptions,
  type GraphParts,
  type GraphProps,
  type OverlayNodeProps,
} from './graph.js';
export {
  useGraph,
  useSelection,
  useUndoRedo,
  useViewport,
  type UseGraphResult,
  type UseUndoRedoResult,
} from './hooks.js';
export {
  EMPTY_GRAPH_STATE,
  createGraphStore,
  type GraphStore,
  type GraphStoreDeps,
  type GraphStoreState,
} from './store.js';

/** The package's canonical name. */
export const PACKAGE_NAME = '@graphloom/react';
