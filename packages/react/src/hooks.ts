import type { Clipboard } from '@graphloom/clipboard';
import type { Edge, GraphEditor, Group, Node, Viewport } from '@graphloom/core';
import type { History } from '@graphloom/history';
import type { InteractionEngine } from '@graphloom/interaction';
import type { RenderHost } from '@graphloom/rendering';
import { useCallback, useContext, useSyncExternalStore } from 'react';
import { GraphContext, type GraphParts } from './graph.js';
import { EMPTY_GRAPH_STATE, type GraphStoreState } from './store.js';

const noopSubscribe = (): (() => void) => () => {};

/** The graph parts from context, or `null` before the editor exists. */
function useGraphParts(): GraphParts | null {
  const parts = useContext(GraphContext);
  if (parts === undefined) {
    throw new Error('GraphLoom hooks must be used inside a <Graph> component.');
  }
  return parts;
}

/**
 * One slice of the bridged store via `useSyncExternalStore` (P6-T02). The
 * selector must be referentially stable (module-level). Before the editor
 * exists — and on the server — it selects from {@link EMPTY_GRAPH_STATE}, so
 * snapshots stay stable and hydration-safe.
 */
function useSlice<T>(
  parts: GraphParts | null,
  select: (state: GraphStoreState) => T,
): T {
  const store = parts?.store;
  const getSnapshot = useCallback(
    () => select(store ? store.getState() : EMPTY_GRAPH_STATE),
    [store, select],
  );
  return useSyncExternalStore(
    store ? store.subscribe : noopSubscribe,
    getSnapshot,
    getSnapshot,
  );
}

const selectNodes = (state: GraphStoreState): readonly Node[] => state.nodes;
const selectEdges = (state: GraphStoreState): readonly Edge[] => state.edges;
const selectGroups = (state: GraphStoreState): readonly Group[] => state.groups;
const selectSelection = (state: GraphStoreState): readonly string[] => state.selection;
const selectViewport = (state: GraphStoreState): Viewport => state.viewport;
const selectCanUndo = (state: GraphStoreState): boolean => state.canUndo;
const selectCanRedo = (state: GraphStoreState): boolean => state.canRedo;

/** What {@link useGraph} returns: reactive content slices plus the services. */
export interface UseGraphResult {
  /** True once the editor exists (first client effect; never on the server). */
  readonly ready: boolean;
  /** All nodes (re-renders only when a commit touches nodes). */
  readonly nodes: readonly Node[];
  /** All edges (re-renders only when a commit touches edges). */
  readonly edges: readonly Edge[];
  /** All groups (re-renders only when a commit touches groups). */
  readonly groups: readonly Group[];
  /** The live editor, or `null` until {@link UseGraphResult.ready}. */
  readonly editor: GraphEditor | null;
  /** The undo/redo service, or `null` until ready. */
  readonly history: History | null;
  /** The copy/paste service, or `null` until ready. */
  readonly clipboard: Clipboard | null;
  /** The interaction engine, or `null` until ready. */
  readonly engine: InteractionEngine | null;
  /** The rendering pipeline, or `null` until ready. */
  readonly host: RenderHost | null;
}

/**
 * The graph content (nodes/edges/groups, concurrent-safe via
 * `useSyncExternalStore`) plus the wired services of the enclosing
 * {@link GraphContext} provider (P6-T01).
 */
export function useGraph(): UseGraphResult {
  const parts = useGraphParts();
  const nodes = useSlice(parts, selectNodes);
  const edges = useSlice(parts, selectEdges);
  const groups = useSlice(parts, selectGroups);
  return {
    ready: parts !== null,
    nodes,
    edges,
    groups,
    editor: parts?.editor ?? null,
    history: parts?.history ?? null,
    clipboard: parts?.clipboard ?? null,
    engine: parts?.engine ?? null,
    host: parts?.host ?? null,
  };
}

/** The selected element ids; re-renders only on selection changes. */
export function useSelection(): readonly string[] {
  return useSlice(useGraphParts(), selectSelection);
}

/** The current pan/zoom state; re-renders only on viewport changes. */
export function useViewport(): Viewport {
  return useSlice(useGraphParts(), selectViewport);
}

/** What {@link useUndoRedo} returns. */
export interface UseUndoRedoResult {
  /** Whether undo would do anything. */
  readonly canUndo: boolean;
  /** Whether redo would do anything. */
  readonly canRedo: boolean;
  /** Undoes the newest history entry (no-op before ready or when empty). */
  readonly undo: () => void;
  /** Redoes the newest undone entry (no-op before ready or when empty). */
  readonly redo: () => void;
}

/** Undo/redo state and actions; re-renders only on history changes. */
export function useUndoRedo(): UseUndoRedoResult {
  const parts = useGraphParts();
  const canUndo = useSlice(parts, selectCanUndo);
  const canRedo = useSlice(parts, selectCanRedo);
  const undo = useCallback(() => {
    parts?.history.undo();
  }, [parts]);
  const redo = useCallback(() => {
    parts?.history.redo();
  }, [parts]);
  return { canUndo, canRedo, undo, redo };
}
