import { signal, type Signal } from '@angular/core';
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

/** Sources {@link createGraphSignals} bridges into Angular signals. */
export interface GraphSignalsDeps {
  readonly editor: GraphEditor;
  /** Selection model; without it `selection()` stays empty. */
  readonly selection?: Selection;
  /** Viewport controller; without it `viewport()` stays at the identity. */
  readonly viewport?: ViewportController;
  /** Undo/redo service; without it `canUndo()`/`canRedo()` stay false. */
  readonly history?: History;
}

/**
 * The core state exposed as fine-grained Angular signals (P5-T02). Each slice
 * only updates when a commit actually touched it, and a whole transaction
 * produces at most one update per slice (`graph.change` fires once per
 * commit), so unrelated changes never recompute consumers.
 */
export interface GraphSignals {
  /** All nodes, refreshed when a commit touches nodes. */
  readonly nodes: Signal<readonly Node[]>;
  /** All edges, refreshed when a commit touches edges (incl. node cascades). */
  readonly edges: Signal<readonly Edge[]>;
  /** All groups, refreshed when a commit touches groups or memberships. */
  readonly groups: Signal<readonly Group[]>;
  /** Selected element ids (interaction layer state). */
  readonly selection: Signal<readonly string[]>;
  /** Current pan/zoom state. */
  readonly viewport: Signal<Viewport>;
  /** Whether undo would do anything. */
  readonly canUndo: Signal<boolean>;
  /** Whether redo would do anything. */
  readonly canRedo: Signal<boolean>;
  /** Unsubscribes every bridge listener; signals freeze at their last value. */
  destroy(): void;
}

/**
 * Bridges a graph editor's synchronous event stream into Angular signals.
 * Framework-free consumers keep using `editor.on`; Angular templates and
 * `computed`/`effect` consumers read these instead of subscribing manually.
 */
export function createGraphSignals(deps: GraphSignalsDeps): GraphSignals {
  const { editor } = deps;
  const nodes = signal<readonly Node[]>([...editor.graph.nodes()]);
  const edges = signal<readonly Edge[]>([...editor.graph.edges()]);
  const groups = signal<readonly Group[]>([...editor.graph.groups()]);
  const selection = signal<readonly string[]>(
    deps.selection ? [...deps.selection.ids()] : [],
  );
  const viewport = signal<Viewport>(
    deps.viewport ? deps.viewport.viewport : { x: 0, y: 0, zoom: 1 },
  );
  const canUndo = signal(deps.history?.canUndo ?? false);
  const canRedo = signal(deps.history?.canRedo ?? false);

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
      if (touchedNodes) nodes.set([...editor.graph.nodes()]);
      if (touchedEdges) edges.set([...editor.graph.edges()]);
      if (touchedGroups) groups.set([...editor.graph.groups()]);
    }),
  ];
  const sel = deps.selection;
  if (sel) {
    subscriptions.push(
      sel.on('selection.changed', ({ selected }) => selection.set(selected)),
    );
  }
  if (deps.viewport) {
    subscriptions.push(
      deps.viewport.on('viewport.changed', ({ viewport: next }) =>
        viewport.set(next),
      ),
    );
  }
  if (deps.history) {
    subscriptions.push(
      deps.history.on('history.changed', (state) => {
        canUndo.set(state.canUndo);
        canRedo.set(state.canRedo);
      }),
    );
  }

  return {
    nodes: nodes.asReadonly(),
    edges: edges.asReadonly(),
    groups: groups.asReadonly(),
    selection: selection.asReadonly(),
    viewport: viewport.asReadonly(),
    canUndo: canUndo.asReadonly(),
    canRedo: canRedo.asReadonly(),
    destroy: () => {
      for (const unsubscribe of subscriptions.splice(0)) unsubscribe();
    },
  };
}
