import { commands, Emitter, type GraphEditor, type Point, type Unsubscribe } from '@graphloom/core';
import { boundsOfPoints, type Rect, type ViewportController } from '@graphloom/rendering';
import type { Modifiers } from './gestures.js';

/** Context handed to a snap provider on every drag update (P4-T06 hook). */
export interface SnapContext {
  /** Union bounds of the dragged nodes at their unsnapped preview positions. */
  readonly bounds: Rect;
  /** Ids of the nodes being dragged (excluded from snap candidates). */
  readonly nodeIds: readonly string[];
  /** True while the snap toggle key (alt) is held — provider should pass through. */
  readonly disabled: boolean;
}

/** Adjusts a raw world-space drag offset (grid/object snapping). */
export type SnapProvider = (offset: Point, context: SnapContext) => Point;

/** Events emitted by {@link DragController}. */
export interface DragEventMap {
  /**
   * Ephemeral preview positions (ADR-0001: never in the model or history).
   * Renderers overlay these; an empty map means the preview is gone.
   */
  'drag.preview': { readonly positions: ReadonlyMap<string, Point> };
}

/** Options for {@link DragController}. */
export interface DragControllerOptions {
  /** Distance (px) from a viewport edge that triggers auto-pan. Default 24. */
  readonly autoPanMargin?: number;
  /** Snap provider consulted on every move (P4-T06). */
  readonly snap?: SnapProvider;
}

/**
 * Node dragging (P4-T04, ADR-0001): previews are ephemeral offsets over the
 * committed positions; releasing commits **one** transaction (one history
 * entry regardless of node count); cancel/ESC leaves the model untouched.
 * Locked nodes never enter the drag set.
 */
export class DragController {
  #editor: GraphEditor;
  #viewport: ViewportController;
  #margin: number;
  #snap: SnapProvider | undefined;
  #emitter = new Emitter<DragEventMap>();
  /** nodeId → committed position at grab time. */
  #originals: Map<string, Point> | null = null;
  #grabWorld: Point = { x: 0, y: 0 };
  #preview = new Map<string, Point>();

  constructor(
    editor: GraphEditor,
    viewport: ViewportController,
    options: DragControllerOptions = {},
  ) {
    this.#editor = editor;
    this.#viewport = viewport;
    this.#margin = options.autoPanMargin ?? 24;
    this.#snap = options.snap;
  }

  /** True while a drag is in flight. */
  get active(): boolean {
    return this.#originals !== null;
  }

  /** Current preview positions (empty when idle). */
  get preview(): ReadonlyMap<string, Point> {
    return this.#preview;
  }

  /** Subscribes to drag events; returns an unsubscriber. */
  on<K extends keyof DragEventMap>(
    type: K,
    handler: (payload: DragEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /**
   * Starts dragging `nodeIds` from the screen point `origin`. Locked and
   * missing nodes are dropped; returns false (no drag) when nothing movable
   * remains.
   */
  begin(nodeIds: readonly string[], origin: Point): boolean {
    const originals = new Map<string, Point>();
    for (const id of nodeIds) {
      const node = this.#editor.graph.getNode(id);
      if (node && !node.locked) originals.set(id, node.position);
    }
    if (originals.size === 0) return false;
    this.#originals = originals;
    this.#grabWorld = this.#viewport.screenToWorld(origin);
    return true;
  }

  /** Updates the preview from the current screen point (auto-pans at edges). */
  move(point: Point, modifiers?: Modifiers): void {
    if (!this.#originals) return;
    this.#autoPan(point);
    const world = this.#viewport.screenToWorld(point);
    let offset: Point = { x: world.x - this.#grabWorld.x, y: world.y - this.#grabWorld.y };
    if (this.#snap) {
      offset = this.#snap(offset, {
        bounds: this.#previewBounds(offset),
        nodeIds: [...this.#originals.keys()],
        disabled: modifiers?.alt ?? false,
      });
    }
    this.#preview = new Map(
      [...this.#originals].map(([id, p]) => [id, { x: p.x + offset.x, y: p.y + offset.y }]),
    );
    this.#emitter.emit('drag.preview', { positions: this.#preview });
  }

  /** Commits the preview as one transaction. No-op without movement. */
  end(): void {
    const originals = this.#originals;
    const preview = this.#preview;
    this.#clear();
    if (!originals || preview.size === 0) return;
    const moved = [...preview].filter(([id, p]) => {
      const o = originals.get(id);
      return o !== undefined && (o.x !== p.x || o.y !== p.y);
    });
    if (moved.length === 0) return;
    this.#editor.transact(() => {
      for (const [id, position] of moved) {
        this.#editor.execute(commands.nodeUpdate(id, { position }));
      }
    });
  }

  /** Aborts the drag (ESC / pointercancel): model untouched, preview discarded. */
  cancel(): void {
    this.#clear();
  }

  #clear(): void {
    const hadPreview = this.#preview.size > 0;
    this.#originals = null;
    this.#preview = new Map();
    if (hadPreview) this.#emitter.emit('drag.preview', { positions: this.#preview });
  }

  /**
   * Pans the viewport when the pointer crosses into the edge margin, so
   * dragging past the visible rect scrolls the canvas (the world offset
   * follows automatically because previews derive from screen→world).
   */
  // ponytail: pans only on move events — a pointer held still at the edge
  // stops panning; wire a ticker into the host loop if continuous pan matters.
  #autoPan(point: Point): void {
    const { width, height } = this.#viewport.size;
    if (width <= 0 || height <= 0) return;
    const m = this.#margin;
    const dx = Math.min(0, point.x - m) + Math.max(0, point.x - (width - m));
    const dy = Math.min(0, point.y - m) + Math.max(0, point.y - (height - m));
    if (dx !== 0 || dy !== 0) this.#viewport.panBy(-dx, -dy);
  }

  #previewBounds(offset: Point): Rect {
    const corners: Point[] = [];
    for (const [id, p] of this.#originals ?? []) {
      const node = this.#editor.graph.getNode(id);
      if (!node) continue;
      corners.push(
        { x: p.x + offset.x, y: p.y + offset.y },
        { x: p.x + offset.x + node.size.width, y: p.y + offset.y + node.size.height },
      );
    }
    return boundsOfPoints(corners);
  }
}
