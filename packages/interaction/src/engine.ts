import { Emitter, type GraphEditor, type Point, type Unsubscribe } from '@graphloom/core';
import {
  edgeAnchor,
  SpatialIndex,
  type Rect,
  type RenderItem,
  type SceneGraph,
  type ViewportController,
} from '@graphloom/rendering';
import { ConnectController, type ConnectOptions } from './connect.js';
import { buildContextMenuRequest, type ContextMenuRequest } from './contextmenu.js';
import { DragController, type DragControllerOptions } from './drag.js';
import {
  GestureRecognizer,
  type DragGesture,
  type GestureOptions,
  type GesturePoint,
  type KeyInput,
  type PointerInput,
  type WheelInput,
} from './gestures.js';
import { createShortcutHandler, DEFAULT_KEYMAP, type Keymap } from './keymap.js';
import { PanZoomController, type PanZoomOptions } from './panzoom.js';
import { Selection } from './selection.js';
import { Snapper, type SnapOptions } from './snap.js';
import { handlePositions, TransformController, type HandleId, type TransformOptions } from './transform.js';

/** What the engine needs from the host wiring (all P3 pieces). */
export interface InteractionEngineDeps {
  readonly editor: GraphEditor;
  readonly scene: SceneGraph;
  readonly viewport: ViewportController;
  /** Defaults to a fresh index over `scene`. */
  readonly spatial?: SpatialIndex;
  /** Undo/redo service; keyboard undo/redo are no-ops without it. */
  readonly history?: { undo(): boolean; redo(): boolean };
}

/** Options for {@link InteractionEngine} (each sub-controller's knobs). */
export interface InteractionEngineOptions {
  readonly gestures?: GestureOptions;
  readonly drag?: Omit<DragControllerOptions, 'snap'>;
  /** `false` disables snapping entirely. */
  readonly snap?: SnapOptions | false;
  readonly connect?: ConnectOptions;
  readonly transform?: TransformOptions;
  readonly panZoom?: PanZoomOptions;
  readonly keymap?: Keymap;
  /** Pick slop for taps/drags, in screen pixels. Default 4. */
  readonly pickTolerance?: number;
  /** Hit radius around selection handles, in screen pixels. Default 6. */
  readonly handleRadius?: number;
  /** Hit radius around ports for starting a connection, in screen pixels. Default 10. */
  readonly portRadius?: number;
}

/** Events emitted by {@link InteractionEngine}. */
export interface EngineEventMap {
  /** Live marquee rect in world coordinates (`null` when the marquee ends). */
  'marquee.changed': { readonly rect: Rect | null };
  /** Right-click / long-press produced a menu request (host renders the UI). */
  'contextmenu.requested': { readonly request: ContextMenuRequest };
}

type Mode = 'idle' | 'pan' | 'marquee' | 'drag' | 'transform' | 'connect';

/**
 * The interaction engine (Phase 4 glue): routes gestures to pan/zoom,
 * selection, drag, resize/rotate, connect, and context-menu controllers so
 * hosts and framework wrappers stay logic-free. Fully headless — hosts feed
 * normalized {@link PointerInput}/{@link WheelInput}/{@link KeyInput}
 * samples; a DOM adapter arrives with the demo wiring.
 *
 * Routing for a primary-button drag, by what's under the pointer: selection
 * handle → transform; port → connect; node/group body → drag; empty canvas →
 * marquee. Middle button or {@link InteractionEngine.panMode} (space) → pan.
 */
export class InteractionEngine {
  readonly selection: Selection;
  readonly gestures: GestureRecognizer;
  readonly panZoom: PanZoomController;
  readonly drag: DragController;
  readonly transform: TransformController;
  readonly connect: ConnectController;
  readonly snapper: Snapper | null;
  readonly spatial: SpatialIndex;
  /** While true (space held), primary drags pan instead of selecting/moving. */
  panMode = false;

  #editor: GraphEditor;
  #viewport: ViewportController;
  #emitter = new Emitter<EngineEventMap>();
  #handleKey: (input: KeyInput) => boolean;
  #pickTolerance: number;
  #handleRadius: number;
  #portRadius: number;
  #mode: Mode = 'idle';
  #marqueeOrigin: Point | null = null;
  #marqueeBaseline: readonly string[] = [];

  constructor(deps: InteractionEngineDeps, options: InteractionEngineOptions = {}) {
    this.#editor = deps.editor;
    this.#viewport = deps.viewport;
    this.spatial = deps.spatial ?? new SpatialIndex(deps.scene);
    this.selection = new Selection(deps.editor);
    this.gestures = new GestureRecognizer(options.gestures);
    this.panZoom = new PanZoomController(deps.viewport, options.panZoom);
    this.snapper =
      options.snap === false ? null : new Snapper(this.spatial, deps.viewport, options.snap);
    this.drag = new DragController(deps.editor, deps.viewport, {
      ...options.drag,
      ...(this.snapper && { snap: this.snapper.provider() }),
    });
    this.transform = new TransformController(deps.editor, deps.viewport, options.transform);
    this.connect = new ConnectController(deps.editor, this.spatial, deps.viewport, options.connect);
    this.#pickTolerance = options.pickTolerance ?? 4;
    this.#handleRadius = options.handleRadius ?? 6;
    this.#portRadius = options.portRadius ?? 10;
    this.#handleKey = createShortcutHandler(
      {
        editor: deps.editor,
        selection: this.selection,
        viewport: deps.viewport,
        ...(deps.history && { history: deps.history }),
        cancel: () => this.cancelActive(),
      },
      options.keymap ?? DEFAULT_KEYMAP,
    );

    this.gestures.on('drag-start', (g) => this.#dragStart(g));
    this.gestures.on('drag-move', (g) => this.#dragMove(g));
    this.gestures.on('drag-end', (g) => this.#dragEnd(g));
    this.gestures.on('drag-cancel', () => this.cancelActive());
    this.gestures.on('tap', (g) => this.#tap(g));
    this.gestures.on('long-press', (g) => this.#requestMenu(g.point));
    this.gestures.on('pinch-move', (g) => this.panZoom.pinch(g));
  }

  // ---- host-facing input feed --------------------------------------------

  /** Feeds a pointer-down sample. */
  pointerDown(input: PointerInput): void {
    this.gestures.down(input);
  }

  /** Feeds a pointer-move sample. */
  pointerMove(input: PointerInput): void {
    this.gestures.move(input);
  }

  /** Feeds a pointer-up sample. */
  pointerUp(input: PointerInput): void {
    this.gestures.up(input);
  }

  /** Feeds a pointercancel sample. */
  pointerCancel(input: PointerInput): void {
    this.gestures.cancel(input);
  }

  /** Feeds a wheel sample (zoom about cursor / trackpad pinch). */
  wheel(input: WheelInput): void {
    this.panZoom.wheel(input);
  }

  /** Feeds a key-down; returns true when handled (host should preventDefault). */
  key(input: KeyInput): boolean {
    return this.#handleKey(input);
  }

  /** Subscribes to engine events; returns an unsubscriber. */
  on<K extends keyof EngineEventMap>(
    type: K,
    handler: (payload: EngineEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** Cancels whatever gesture is in flight; true if something was cancelled. */
  cancelActive(): boolean {
    const mode = this.#mode;
    this.#mode = 'idle';
    switch (mode) {
      case 'drag':
        this.drag.cancel();
        this.snapper?.clear();
        return true;
      case 'transform':
        this.transform.cancel();
        return true;
      case 'connect':
        this.connect.cancel();
        return true;
      case 'marquee':
        this.#marqueeOrigin = null;
        this.#emitter.emit('marquee.changed', { rect: null });
        return true;
      case 'pan':
        return true;
      default:
        return false;
    }
  }

  // ---- routing -------------------------------------------------------------

  #dragStart(g: DragGesture): void {
    if (g.button === 1 || this.panMode) {
      this.#mode = 'pan';
      return;
    }
    if (g.button !== 0) return;
    const world = this.#viewport.screenToWorld(g.origin);

    // 1. Selection handles (single selected node).
    const handled = this.#hitHandle(g.origin);
    if (handled) {
      const node = this.#editor.graph.getNode(handled.nodeId);
      if (node && this.transform.begin(node, handled.handle, g.origin)) {
        this.#mode = 'transform';
        return;
      }
    }

    const hit = this.#hitElement(world);

    // 2. Ports: start a connection.
    if (hit?.element === 'node') {
      const port = this.#hitPort(hit.elementId, world);
      if (port !== null && this.connect.begin(hit.elementId, port, g.origin)) {
        this.#mode = 'connect';
        return;
      }
    }

    // 3. Node/group body: move it (selecting the node first if needed).
    if (hit?.element === 'node' || hit?.element === 'group') {
      const nodeIds = this.#dragSetFor(hit, g);
      if (this.drag.begin(nodeIds, g.origin)) {
        this.#mode = 'drag';
        return;
      }
      return; // locked-only target: swallow the drag
    }

    // 4. Empty canvas (or an edge): marquee.
    this.#mode = 'marquee';
    this.#marqueeOrigin = world;
    this.#marqueeBaseline = g.modifiers.shift ? this.selection.ids() : [];
    this.#emitter.emit('marquee.changed', { rect: { x: world.x, y: world.y, width: 0, height: 0 } });
  }

  #dragMove(g: DragGesture): void {
    switch (this.#mode) {
      case 'pan':
        this.panZoom.panBy(g.delta.x, g.delta.y);
        return;
      case 'drag':
        this.drag.move(g.point, g.modifiers);
        return;
      case 'transform':
        this.transform.move(g.point, g.modifiers);
        return;
      case 'connect':
        this.connect.move(g.point);
        return;
      case 'marquee': {
        const rect = this.#marqueeRect(g.point);
        if (!rect) return;
        this.#emitter.emit('marquee.changed', { rect });
        this.selection.set(this.#marqueeBaseline);
        this.selection.marquee(rect, this.spatial, 'add');
        return;
      }
      default:
        return;
    }
  }

  #dragEnd(g: DragGesture): void {
    const mode = this.#mode;
    this.#mode = 'idle';
    switch (mode) {
      case 'drag':
        this.drag.end();
        this.snapper?.clear();
        return;
      case 'transform':
        this.transform.end();
        return;
      case 'connect':
        this.connect.end();
        return;
      case 'marquee': {
        const rect = this.#marqueeRect(g.point);
        if (rect) {
          this.selection.set(this.#marqueeBaseline);
          this.selection.marquee(rect, this.spatial, 'add');
        }
        this.#marqueeOrigin = null;
        this.#emitter.emit('marquee.changed', { rect: null });
        return;
      }
      default:
        return;
    }
  }

  #tap(g: GesturePoint): void {
    if (g.button === 2) {
      this.#requestMenu(g.point);
      return;
    }
    if (g.button !== 0) return;
    const hit = this.#hitElement(this.#viewport.screenToWorld(g.point));
    if (!hit || hit.element === 'group') {
      if (!g.modifiers.shift) this.selection.clear();
      return;
    }
    if (g.modifiers.shift) this.selection.toggle(hit.elementId);
    else this.selection.set([hit.elementId]);
  }

  #requestMenu(screenPoint: Point): void {
    const world = this.#viewport.screenToWorld(screenPoint);
    this.#emitter.emit('contextmenu.requested', {
      request: buildContextMenuRequest(
        this.#editor,
        this.selection,
        this.spatial,
        world,
        screenPoint,
        this.#pickTolerance / this.#viewport.viewport.zoom,
      ),
    });
  }

  // ---- hit helpers ---------------------------------------------------------

  #hitElement(world: Point): RenderItem | null {
    return this.spatial.hitTest(world, {
      tolerance: this.#pickTolerance / this.#viewport.viewport.zoom,
    });
  }

  /** The selection handle under `screen`, when exactly one node is selected. */
  #hitHandle(screen: Point): { nodeId: string; handle: HandleId } | null {
    const ids = this.selection.nodeIds();
    if (ids.length !== 1 || this.selection.size !== 1) return null;
    const node = this.#editor.graph.getNode(ids[0]!);
    if (!node || node.locked) return null;
    const zoom = this.#viewport.viewport.zoom;
    const positions = handlePositions(node, 24 / zoom);
    for (const [handle, world] of Object.entries(positions)) {
      const s = this.#viewport.worldToScreen(world);
      if (Math.hypot(s.x - screen.x, s.y - screen.y) <= this.#handleRadius) {
        return { nodeId: node.id, handle: handle as HandleId };
      }
    }
    return null;
  }

  /**
   * The port of `nodeId` within the port radius of `world`, `undefined` for
   * "no specific port", or `null` when the pointer is not near any port
   * (drag means move, not connect).
   */
  #hitPort(nodeId: string, world: Point): string | null {
    const node = this.#editor.graph.getNode(nodeId);
    if (!node) return null;
    const radius = this.#portRadius / this.#viewport.viewport.zoom;
    let best: string | null = null;
    let bestDist = radius;
    for (const port of node.ports) {
      const anchor = edgeAnchor(node, port.id);
      const d = Math.hypot(anchor.x - world.x, anchor.y - world.y);
      if (d <= bestDist) {
        bestDist = d;
        best = port.id;
      }
    }
    return best;
  }

  #dragSetFor(hit: RenderItem, g: DragGesture): readonly string[] {
    if (hit.element === 'group') {
      return this.#editor.graph.getGroup(hit.elementId)?.members ?? [];
    }
    if (!this.selection.has(hit.elementId)) {
      if (g.modifiers.shift) this.selection.add([hit.elementId]);
      else this.selection.set([hit.elementId]);
    }
    return this.selection.nodeIds();
  }

  #marqueeRect(current: Point): Rect | null {
    if (!this.#marqueeOrigin) return null;
    const world = this.#viewport.screenToWorld(current);
    const o = this.#marqueeOrigin;
    return {
      x: Math.min(o.x, world.x),
      y: Math.min(o.y, world.y),
      width: Math.abs(world.x - o.x),
      height: Math.abs(world.y - o.y),
    };
  }
}
