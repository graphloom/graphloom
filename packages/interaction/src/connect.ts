import {
  commands,
  createEdge,
  Emitter,
  type EdgeInit,
  type GraphEditor,
  type Node,
  type Point,
  type Unsubscribe,
} from '@graphloom/core';
import { edgeAnchor, type SpatialIndex, type ViewportController } from '@graphloom/rendering';

/** One end of a pending connection. */
export interface ConnectEndpoint {
  readonly nodeId: string;
  readonly portId?: string;
}

/**
 * Ephemeral preview of an in-flight connection gesture (P4-T07). Hosts draw
 * the rubber edge from `from` to `to` and style the candidate by `valid`
 * (invalid targets are visually rejected but never block the gesture).
 */
export interface ConnectPreview {
  readonly source: ConnectEndpoint;
  /** World anchor of the source (port position or node center). */
  readonly from: Point;
  /** Rubber-band end: the snapped target anchor, else the pointer. */
  readonly to: Point;
  /** Candidate endpoint under/near the pointer, if any. */
  readonly target: ConnectEndpoint | null;
  /** Whether committing to `target` would pass the validators. */
  readonly valid: boolean;
  /** Validator rejection reason when `valid` is false and a target exists. */
  readonly reason: string | null;
}

/** Events emitted by {@link ConnectController}. */
export interface ConnectEventMap {
  /** Preview state changed (`null` when the gesture ends/cancels). */
  'connect.preview': { readonly preview: ConnectPreview | null };
}

/** Options for {@link ConnectController}. */
export interface ConnectOptions {
  /** Magnetic snap radius around targets, in screen pixels. Default 16. */
  readonly snapRadius?: number;
}

/**
 * Runs every registered connection validator (P2-T09 registry) against the
 * would-be edge — the exact check `edge.add` runs at commit, so the live UI
 * and the command boundary can never disagree.
 */
export function canConnect(editor: GraphEditor, init: EdgeInit): true | string {
  if (!editor.graph.getNode(init.source)) return `unknown source node "${init.source}"`;
  if (!editor.graph.getNode(init.target)) return `unknown target node "${init.target}"`;
  const edge = createEdge(init);
  for (const validator of editor.registries.validators.values()) {
    const result = validator(editor.graph, edge);
    if (result !== true) return result;
  }
  return true;
}

/**
 * Drag-from-port edge creation (P4-T07): rubber-band preview, magnetic snap
 * to the nearest port (else node center) within a screen-space radius, live
 * validator consultation, drop-on-canvas cancel. Committing is a single
 * `edge.add` — constraints are enforced again at the command boundary.
 */
export class ConnectController {
  #editor: GraphEditor;
  #spatial: SpatialIndex;
  #viewport: ViewportController;
  #snapRadius: number;
  #emitter = new Emitter<ConnectEventMap>();
  #state: { source: ConnectEndpoint; from: Point; preview: ConnectPreview } | null = null;

  constructor(
    editor: GraphEditor,
    spatial: SpatialIndex,
    viewport: ViewportController,
    options: ConnectOptions = {},
  ) {
    this.#editor = editor;
    this.#spatial = spatial;
    this.#viewport = viewport;
    this.#snapRadius = options.snapRadius ?? 16;
  }

  /** True while a connection gesture is in flight. */
  get active(): boolean {
    return this.#state !== null;
  }

  /** Current preview (`null` when idle). */
  get preview(): ConnectPreview | null {
    return this.#state?.preview ?? null;
  }

  /** Subscribes to connect events; returns an unsubscriber. */
  on<K extends keyof ConnectEventMap>(
    type: K,
    handler: (payload: ConnectEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** Starts a connection from `nodeId` (optionally a specific port). */
  begin(nodeId: string, portId: string | undefined, origin: Point): boolean {
    const node = this.#editor.graph.getNode(nodeId);
    if (!node || node.hidden) return false;
    const source: ConnectEndpoint = portId === undefined ? { nodeId } : { nodeId, portId };
    const from = edgeAnchor(node, portId);
    this.#state = {
      source,
      from,
      preview: {
        source,
        from,
        to: this.#viewport.screenToWorld(origin),
        target: null,
        valid: false,
        reason: null,
      },
    };
    this.#emit();
    return true;
  }

  /** Updates the rubber band; snaps to and validates the candidate target. */
  move(point: Point): void {
    const s = this.#state;
    if (!s) return;
    const world = this.#viewport.screenToWorld(point);
    const radius = this.#snapRadius / this.#viewport.viewport.zoom;
    const candidate = this.#findTarget(world, radius);
    if (!candidate) {
      s.preview = { ...s.preview, to: world, target: null, valid: false, reason: null };
    } else {
      const init: EdgeInit = {
        source: s.source.nodeId,
        target: candidate.endpoint.nodeId,
        ...(s.source.portId !== undefined && { sourcePort: s.source.portId }),
        ...(candidate.endpoint.portId !== undefined && {
          targetPort: candidate.endpoint.portId,
        }),
      };
      const verdict = canConnect(this.#editor, init);
      s.preview = {
        ...s.preview,
        to: candidate.anchor,
        target: candidate.endpoint,
        valid: verdict === true,
        reason: verdict === true ? null : verdict,
      };
    }
    this.#emit();
  }

  /** Commits the connection if a valid target is snapped; otherwise cancels. */
  end(): void {
    const s = this.#state;
    this.#clear();
    if (!s || !s.preview.valid || !s.preview.target) return;
    this.#editor.execute(
      commands.edgeAdd({
        source: s.source.nodeId,
        target: s.preview.target.nodeId,
        ...(s.source.portId !== undefined && { sourcePort: s.source.portId }),
        ...(s.preview.target.portId !== undefined && {
          targetPort: s.preview.target.portId,
        }),
      }),
    );
  }

  /** Aborts the gesture (ESC / pointercancel / drop on canvas). */
  cancel(): void {
    this.#clear();
  }

  /**
   * The magnetic candidate near `world`: the node under the pointer, or the
   * closest node/port anchor within `radius`. Ports win over the node center
   * when both are in range.
   */
  #findTarget(
    world: Point,
    radius: number,
  ): { endpoint: ConnectEndpoint; anchor: Point } | null {
    const hit = this.#spatial.hitTest(world, {
      tolerance: radius,
      filter: (item) => item.element === 'node' && item.kind === 'shape',
    });
    if (!hit) return null;
    const node = this.#editor.graph.getNode(hit.elementId);
    if (!node) return null;
    const port = this.#nearestPort(node, world, radius);
    if (port) {
      return { endpoint: { nodeId: node.id, portId: port.id }, anchor: port.anchor };
    }
    return { endpoint: { nodeId: node.id }, anchor: edgeAnchor(node, undefined) };
  }

  #nearestPort(
    node: Node,
    world: Point,
    radius: number,
  ): { id: string; anchor: Point } | null {
    let best: { id: string; anchor: Point } | null = null;
    let bestDist = radius;
    for (const port of node.ports) {
      const anchor = edgeAnchor(node, port.id);
      const d = Math.hypot(anchor.x - world.x, anchor.y - world.y);
      if (d <= bestDist) {
        bestDist = d;
        best = { id: port.id, anchor };
      }
    }
    return best;
  }

  #clear(): void {
    if (!this.#state) return;
    this.#state = null;
    this.#emitter.emit('connect.preview', { preview: null });
  }

  #emit(): void {
    if (this.#state) this.#emitter.emit('connect.preview', { preview: this.#state.preview });
  }
}
