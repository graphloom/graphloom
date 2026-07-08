import { Emitter, type GraphEditor, type Unsubscribe } from '@graphloom/core';
import type { Rect, SpatialIndex } from '@graphloom/rendering';

/** How a marquee/click combines with the existing selection. */
export type SelectMode = 'replace' | 'add' | 'toggle';

/** Events emitted by {@link Selection}. */
export interface SelectionEventMap {
  /** Fires once per state change with the full selected id list. */
  'selection.changed': { readonly selected: readonly string[] };
}

/**
 * The selection model (P4-T03). Selection is UI state by design: it lives
 * outside the graph model and is never undoable (tracker-documented
 * decision) — undoing a move should not resurrect an old selection.
 *
 * Ids may reference nodes or edges. Deleted elements are pruned
 * automatically, so selection survives model changes to unrelated elements.
 */
export class Selection {
  #editor: GraphEditor;
  #ids = new Set<string>();
  #emitter = new Emitter<SelectionEventMap>();
  #subscriptions: Unsubscribe[];

  constructor(editor: GraphEditor) {
    this.#editor = editor;
    const prune = ({ node, edge }: { node?: { id: string }; edge?: { id: string } }): void => {
      const id = node?.id ?? edge?.id;
      if (id !== undefined && this.#ids.delete(id)) this.#notify();
    };
    this.#subscriptions = [
      editor.on('node.deleted', prune),
      editor.on('edge.deleted', prune),
    ];
  }

  /** Selected element ids in insertion order. */
  ids(): readonly string[] {
    return [...this.#ids];
  }

  /** Selected ids that are nodes. */
  nodeIds(): readonly string[] {
    return this.ids().filter((id) => this.#editor.graph.getNode(id) !== undefined);
  }

  /** Whether `id` is selected. */
  has(id: string): boolean {
    return this.#ids.has(id);
  }

  /** Number of selected elements. */
  get size(): number {
    return this.#ids.size;
  }

  /** Replaces the selection. */
  set(ids: readonly string[]): void {
    if (ids.length === this.#ids.size && ids.every((id) => this.#ids.has(id))) return;
    this.#ids = new Set(ids);
    this.#notify();
  }

  /** Adds ids to the selection. */
  add(ids: readonly string[]): void {
    const before = this.#ids.size;
    for (const id of ids) this.#ids.add(id);
    if (this.#ids.size !== before) this.#notify();
  }

  /** Toggles one id (shift-click). */
  toggle(id: string): void {
    if (!this.#ids.delete(id)) this.#ids.add(id);
    this.#notify();
  }

  /** Clears the selection. */
  clear(): void {
    if (this.#ids.size === 0) return;
    this.#ids.clear();
    this.#notify();
  }

  /** Selects every visible node and edge (locked stays click/ctrl-A selectable). */
  selectAll(): void {
    this.set([
      ...this.#editor.graph.nodes().filter((n) => !n.hidden).map((n) => n.id),
      ...this.#editor.graph.edges().filter((e) => !e.hidden).map((e) => e.id),
    ]);
  }

  /**
   * Rubber-band selection: every node/edge whose scene items intersect
   * `rect` (world coordinates). Locked nodes are skipped (tracker rule);
   * hidden elements have no scene items, so they can never match.
   */
  // ponytail: intersects item AABBs, not exact rotated outlines — matches the
  // query index; switch to corner-precise tests if rotated-marquee feel is off.
  marquee(rect: Rect, spatial: SpatialIndex, mode: SelectMode = 'replace'): void {
    const hits = new Set<string>();
    for (const item of spatial.query(rect)) {
      if (item.element === 'node' || item.element === 'edge') {
        if (this.#editor.graph.getNode(item.elementId)?.locked) continue;
        hits.add(item.elementId);
      }
    }
    const ids = [...hits];
    if (mode === 'replace') this.set(ids);
    else if (mode === 'add') this.add(ids);
    else for (const id of ids) this.toggle(id);
  }

  /** Subscribes to selection events; returns an unsubscriber. */
  on<K extends keyof SelectionEventMap>(
    type: K,
    handler: (payload: SelectionEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** Unsubscribes from the editor; the instance is dead afterwards. */
  dispose(): void {
    for (const unsubscribe of this.#subscriptions) unsubscribe();
    this.#subscriptions = [];
  }

  #notify(): void {
    this.#emitter.emit('selection.changed', { selected: this.ids() });
  }
}
