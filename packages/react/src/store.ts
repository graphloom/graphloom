import type {
  Edge,
  GraphEditor,
  Group,
  Node,
  Unsubscribe,
  Viewport,
} from '@graphloom/core';
import type { History } from '@graphloom/history';
import type { Selection } from '@graphloom/interaction';
import type { ViewportController } from '@graphloom/rendering';

/** Sources {@link createGraphStore} bridges into a React external store. */
export interface GraphStoreDeps {
  readonly editor: GraphEditor;
  /** Selection model; without it `selection` stays empty. */
  readonly selection?: Selection;
  /** Viewport controller; without it `viewport` stays at the identity. */
  readonly viewport?: ViewportController;
  /** Undo/redo service; without it `canUndo`/`canRedo` stay false. */
  readonly history?: History;
}

/**
 * One immutable snapshot of the bridged core state (P6-T02). A new object is
 * published per change batch, but each slice keeps its previous identity
 * unless a commit actually touched it — so `useSyncExternalStore` consumers
 * selecting an untouched slice never re-render.
 */
export interface GraphStoreState {
  /** All nodes, refreshed when a commit touches nodes. */
  readonly nodes: readonly Node[];
  /** All edges, refreshed when a commit touches edges (incl. node cascades). */
  readonly edges: readonly Edge[];
  /** All groups, refreshed when a commit touches groups or memberships. */
  readonly groups: readonly Group[];
  /** Selected element ids (interaction layer state). */
  readonly selection: readonly string[];
  /** Current pan/zoom state. */
  readonly viewport: Viewport;
  /** Whether undo would do anything. */
  readonly canUndo: boolean;
  /** Whether redo would do anything. */
  readonly canRedo: boolean;
}

/**
 * The state served before an editor exists (server render, first client
 * render). A frozen singleton so every pre-ready snapshot is identical —
 * `useSyncExternalStore` requires stable server snapshots.
 */
export const EMPTY_GRAPH_STATE: GraphStoreState = Object.freeze({
  nodes: [],
  edges: [],
  groups: [],
  selection: [],
  viewport: { x: 0, y: 0, zoom: 1 },
  canUndo: false,
  canRedo: false,
});

/**
 * A graph editor's synchronous event stream exposed as a
 * `useSyncExternalStore`-compatible store (P6-T02): `subscribe` fires once
 * per change batch (`graph.change` fires once per commit, so a whole
 * transaction is one notification), and `getState` returns the current
 * immutable {@link GraphStoreState}.
 */
export interface GraphStore {
  /** Registers a change listener; returns its unsubscriber. */
  subscribe(listener: () => void): Unsubscribe;
  /** The current state snapshot (stable identity between changes). */
  getState(): GraphStoreState;
  /** Unsubscribes every bridge listener; the state freezes at its last value. */
  destroy(): void;
}

/**
 * Bridges a graph editor's event stream into a {@link GraphStore}. Framework
 * consumers read it through `useSyncExternalStore`; the store itself is
 * framework-free and synchronous, so snapshots can never tear.
 */
export function createGraphStore(deps: GraphStoreDeps): GraphStore {
  const { editor } = deps;
  let state: GraphStoreState = {
    nodes: [...editor.graph.nodes()],
    edges: [...editor.graph.edges()],
    groups: [...editor.graph.groups()],
    selection: deps.selection ? [...deps.selection.ids()] : [],
    viewport: deps.viewport ? deps.viewport.viewport : EMPTY_GRAPH_STATE.viewport,
    canUndo: deps.history?.canUndo ?? false,
    canRedo: deps.history?.canRedo ?? false,
  };
  const listeners = new Set<() => void>();
  const patch = (partial: Partial<GraphStoreState>): void => {
    state = { ...state, ...partial };
    for (const listener of [...listeners]) listener();
  };

  const subscriptions: Unsubscribe[] = [
    editor.on('graph.change', ({ operations }) => {
      let touchedNodes = false;
      let touchedEdges = false;
      let touchedGroups = false;
      for (const { command } of operations) {
        const { type } = command;
        if (type.startsWith('node.')) {
          touchedNodes = true;
          // node.remove cascades incident edges and group memberships, and
          // node.restore (its inverse) puts them back.
          if (type === 'node.remove' || type === 'node.restore') {
            touchedEdges = touchedGroups = true;
          }
        } else if (type.startsWith('edge.')) {
          touchedEdges = true;
        } else if (type.startsWith('group.')) {
          touchedGroups = true;
        } else if (type === 'graph.update') {
          // Document metadata only — no element slice changes.
        } else {
          // ponytail: unknown (plugin) command — refresh every slice rather
          // than guess what it mutated. Precision can come per-plugin later.
          touchedNodes = touchedEdges = touchedGroups = true;
        }
      }
      const partial: {
        nodes?: readonly Node[];
        edges?: readonly Edge[];
        groups?: readonly Group[];
      } = {};
      if (touchedNodes) partial.nodes = [...editor.graph.nodes()];
      if (touchedEdges) partial.edges = [...editor.graph.edges()];
      if (touchedGroups) partial.groups = [...editor.graph.groups()];
      if (touchedNodes || touchedEdges || touchedGroups) patch(partial);
    }),
  ];
  if (deps.selection) {
    subscriptions.push(
      deps.selection.on('selection.changed', ({ selected }) =>
        patch({ selection: selected }),
      ),
    );
  }
  if (deps.viewport) {
    subscriptions.push(
      deps.viewport.on('viewport.changed', ({ viewport: next }) =>
        patch({ viewport: next }),
      ),
    );
  }
  if (deps.history) {
    subscriptions.push(
      deps.history.on('history.changed', ({ canUndo, canRedo }) =>
        patch({ canUndo, canRedo }),
      ),
    );
  }

  return {
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getState: () => state,
    destroy: () => {
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
      listeners.clear();
    },
  };
}
