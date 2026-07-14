import type {
  AppliedOperation,
  ChangeSource,
  Edge,
  Group,
  GraphMeta,
  Node,
  Viewport,
} from './types.js';
import type { LimitKind } from './errors.js';

/** Removes the subscription it was returned for. Safe to call more than once. */
export type Unsubscribe = () => void;

/**
 * All events emitted by a graph editor (spec §Events). Model events fire
 * synchronously after a command or transaction commits; one transaction
 * produces one `graph.change` plus its granular events, in emission order.
 * `node.selected`, `viewport.changed` and `layout.completed` are part of the
 * typed surface now but emitted by later phases (P4, P3, P8 respectively).
 */
export interface GraphEventMap {
  /** One commit (command or transaction) with every applied operation, in order. */
  'graph.change': {
    readonly operations: readonly AppliedOperation[];
    readonly source: ChangeSource;
    /** Present when the commit was executed with a coalescing hint (history merging). */
    readonly coalesceKey?: string;
  };
  /** A node was added to the model. */
  'node.created': { readonly node: Node };
  /** A node was changed; `previous` is the full pre-change node. */
  'node.updated': { readonly node: Node; readonly previous: Node };
  /** A node was removed (its cascaded edges emit their own `edge.deleted`). */
  'node.deleted': { readonly node: Node };
  /** Selection changed (emitted by the interaction layer from P4). */
  'node.selected': { readonly nodeIds: readonly string[] };
  /** An edge was added to the model. */
  'edge.created': { readonly edge: Edge };
  /** An edge was changed; `previous` is the full pre-change edge. */
  'edge.updated': { readonly edge: Edge; readonly previous: Edge };
  /** An edge was removed. */
  'edge.deleted': { readonly edge: Edge };
  /** A group was created. */
  'group.created': { readonly group: Group };
  /** A group's members/collapsed/label/data changed. */
  'group.updated': { readonly group: Group; readonly previous: Group };
  /** A group was dissolved (member nodes are untouched). */
  'group.deleted': { readonly group: Group };
  /** A top-level property of a node or edge changed (spec §Property System). */
  'property.changed': {
    readonly target: 'node' | 'edge';
    readonly id: string;
    /** Top-level property path, e.g. `position` or `data`. */
    readonly path: string;
    /** The old value (undefined when the property was absent). */
    readonly previous: unknown;
    /** The new value (undefined when the property was removed). */
    readonly value: unknown;
  };
  /** Document metadata changed via `graph.update`. */
  'graph.updated': { readonly meta: GraphMeta; readonly previous: GraphMeta };
  /**
   * A host should open an inline label editor (P7-T04 editing contract): the
   * core never renders inputs — hosts show an overlay and commit the result
   * via `node.update`/`edge.update` (one coalesced history entry).
   */
  'label.editRequested': {
    readonly target: 'node' | 'edge';
    readonly id: string;
    /** Index into `Edge.labels` (edges only). */
    readonly labelIndex?: number;
  };
  /** Viewport pan/zoom changed (emitted by rendering from P3). */
  'viewport.changed': { readonly viewport: Viewport };
  /** A layout run finished (emitted by @graphloom/layout from P8). */
  'layout.completed': { readonly layout: string };
  /** A plugin finished installing. */
  'plugin.loaded': { readonly pluginId: string; readonly version: string };
  /** An element count crossed `warnAtRatio` of its limit (fires once per crossing, ADR-0007). */
  'limit.warning': { readonly limit: LimitKind; readonly count: number; readonly max: number };
  /** A commit was rejected because it would exceed a limit (ADR-0007). */
  'limit.exceeded': { readonly limit: LimitKind; readonly attempted: number; readonly max: number };
}

/**
 * Minimal typed synchronous event emitter (zero dependencies).
 *
 * Ordering guarantee: handlers run synchronously, in subscription order.
 * Handlers subscribed while an emit is in flight do not receive that emit;
 * handlers unsubscribed mid-emit are skipped.
 */
export class Emitter<M extends object> {
  #handlers = new Map<keyof M, Set<(payload: never) => void>>();

  /** Subscribes to an event; returns an {@link Unsubscribe} disposer. */
  on<K extends keyof M>(type: K, handler: (payload: M[K]) => void): Unsubscribe {
    let set = this.#handlers.get(type);
    if (!set) {
      set = new Set();
      this.#handlers.set(type, set);
    }
    set.add(handler as (payload: never) => void);
    return () => this.off(type, handler);
  }

  /** Removes a previously subscribed handler (no-op if absent). */
  off<K extends keyof M>(type: K, handler: (payload: M[K]) => void): void {
    this.#handlers.get(type)?.delete(handler as (payload: never) => void);
  }

  /** Emits an event synchronously to current subscribers in subscription order. */
  emit<K extends keyof M>(type: K, payload: M[K]): void {
    const set = this.#handlers.get(type);
    if (!set) return;
    // Copy so subscribe-during-emit doesn't receive this emit.
    for (const handler of [...set]) {
      if (set.has(handler)) (handler as (payload: M[K]) => void)(payload);
    }
  }

  /** Number of live subscriptions for an event (leak testing / debugging). */
  listenerCount(type: keyof M): number {
    return this.#handlers.get(type)?.size ?? 0;
  }
}
