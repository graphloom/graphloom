import type {
  Edge,
  EdgeRouting,
  GraphEditor,
  Group,
  Node,
  Point,
  Unsubscribe,
} from '@graphloom/core';
import {
  applyToPoint,
  boundsOfPoints,
  cubicBezierPoint,
  polylinePointAt,
  rotatedRectBounds,
  rotationAbout,
  unionRects,
  type Rect,
} from './geometry.js';
import { estimateTextSize, type TextMeasurer } from './text.js';

/** Unique id of a render item within a scene (stable across frames). */
export type RenderItemId = string;

/** The renderer layer an item belongs to (ADR-0002 / P3-T07 layer groups). */
export type SceneLayer = 'edges' | 'nodes';

/** Which model element a render item was derived from. */
export type SceneElementKind = 'node' | 'edge' | 'group';

/**
 * Flat, theme-resolved style carried by every render item (ADR-0002: the
 * scene graph resolves styles once; renderers just paint). The real theme
 * system replaces the resolver in P7.
 */
export interface ResolvedStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly textColor: string;
}

/** Properties shared by every render item. */
export interface RenderItemBase {
  readonly id: RenderItemId;
  /** Model element kind this item derives from. */
  readonly element: SceneElementKind;
  /** Id of the source node/edge/group. */
  readonly elementId: string;
  readonly layer: SceneLayer;
  /** Paint order within the layer (higher on top; scene ordering breaks ties). */
  readonly zIndex: number;
  /** World-space axis-aligned bounds (rotation already applied). */
  readonly bounds: Rect;
  readonly style: ResolvedStyle;
}

/** A filled/stroked primitive shape (nodes, collapsed-group proxies). */
export interface ShapeRenderItem extends RenderItemBase {
  readonly kind: 'shape';
  readonly shape: 'rect' | 'ellipse';
  /** Unrotated rect in world coordinates. */
  readonly rect: Rect;
  /** Clockwise degrees about the rect center. */
  readonly rotation: number;
}

/** A stroked edge path. */
export interface PathRenderItem extends RenderItemBase {
  readonly kind: 'path';
  readonly routing: EdgeRouting;
  /**
   * Straight: `[from, to]`. Orthogonal: the polyline. Bézier: `[from,
   * control1, control2, to]` — flatten via geometry helpers for hit tests.
   */
  readonly points: readonly Point[];
}

/** A single-line text label, centered on `position`. */
export interface TextRenderItem extends RenderItemBase {
  readonly kind: 'text';
  readonly text: string;
  /** Center of the laid-out text in world coordinates. */
  readonly position: Point;
}

/** Any render item (ADR-0002 scene graph vocabulary). */
export type RenderItem = ShapeRenderItem | PathRenderItem | TextRenderItem;

/** The dirty sets accumulated since the last {@link SceneGraph.takeDirty}. */
export interface SceneDirty {
  readonly added: readonly RenderItemId[];
  readonly updated: readonly RenderItemId[];
  readonly removed: readonly RenderItemId[];
}

/** Options for {@link SceneGraph}. */
export interface SceneOptions {
  /**
   * Maps a node to its primitive shape until the P7 shape registry lands.
   * Default: `type === 'ellipse'` → ellipse, everything else → rect.
   */
  readonly shapeResolver?: (node: Node) => 'rect' | 'ellipse';
  /**
   * Per-element style overrides merged over the defaults. The P7 theme
   * system plugs in here; until then hosts may override ad hoc.
   */
  readonly styleResolver?: (
    kind: SceneElementKind,
    element: Node | Edge | Group,
  ) => Partial<ResolvedStyle> | undefined;
  /** Text measurer for label bounds (default: SSR-safe estimator). */
  readonly measureText?: TextMeasurer;
}

/** Default node/group style until the P7 theme system exists. */
export const DEFAULT_NODE_STYLE: ResolvedStyle = {
  fill: '#e8eefc',
  stroke: '#3b5bd9',
  strokeWidth: 1.5,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 12,
  textColor: '#1a1f36',
};

/** Default edge style until the P7 theme system exists. */
export const DEFAULT_EDGE_STYLE: ResolvedStyle = {
  fill: 'none',
  stroke: '#8892a6',
  strokeWidth: 1.5,
  fontFamily: 'system-ui, sans-serif',
  fontSize: 11,
  textColor: '#4a5268',
};

const kindRank = { shape: 0, path: 0, text: 1 } as const;
const layerRank = { edges: 0, nodes: 1 } as const;

/**
 * Paint-order comparator: renderer layer first (edges always under nodes,
 * matching P3-T07's layer groups), then ascending zIndex, then element id,
 * then labels above their shape/path. Shared by scene ordering and top-most
 * hit testing so picking always agrees with pixels (ADR-0002).
 */
export function compareRenderItems(a: RenderItem, b: RenderItem): number {
  return (
    layerRank[a.layer] - layerRank[b.layer] ||
    a.zIndex - b.zIndex ||
    (a.elementId < b.elementId ? -1 : a.elementId > b.elementId ? 1 : 0) ||
    kindRank[a.kind] - kindRank[b.kind] ||
    (a.id < b.id ? -1 : 1)
  );
}

/** World-space anchor of an edge endpoint: a port position or the node center. */
export function edgeAnchor(node: Node, portId: string | undefined): Point {
  const { position, size, rotation: deg } = node;
  let local: Point = { x: position.x + size.width / 2, y: position.y + size.height / 2 };
  const port = portId === undefined ? undefined : node.ports.find((p) => p.id === portId);
  if (port) {
    // Offset runs left→right on top/bottom sides, top→bottom on left/right.
    switch (port.side) {
      case 'top':
        local = { x: position.x + port.offset * size.width, y: position.y };
        break;
      case 'bottom':
        local = { x: position.x + port.offset * size.width, y: position.y + size.height };
        break;
      case 'left':
        local = { x: position.x, y: position.y + port.offset * size.height };
        break;
      case 'right':
        local = { x: position.x + size.width, y: position.y + port.offset * size.height };
        break;
    }
  }
  if (deg % 360 === 0) return local;
  const rect: Rect = { x: position.x, y: position.y, width: size.width, height: size.height };
  return applyToPoint(
    rotationAbout(deg, rect.x + rect.width / 2, rect.y + rect.height / 2),
    local,
  );
}

/**
 * Derived, renderer-free description of what to draw (ADR-0002): flattened,
 * z-ordered render items with resolved geometry, transforms, and styles.
 * Maintained incrementally from model change events; `rebuild()` re-derives
 * every element from scratch (fallback and test oracle).
 *
 * Visibility rules (P3 decisions, see Decision Log): a node renders unless
 * `hidden` or any containing group is collapsed; an edge renders only while
 * both endpoints render; a collapsed group renders one proxy rect (plus
 * label) over its members' union bounds.
 */
export class SceneGraph {
  #editor: GraphEditor;
  #options: SceneOptions;
  #items = new Map<RenderItemId, RenderItem>();
  /** `${kind}:${elementId}` → item ids derived from that element. */
  #byElement = new Map<string, Set<RenderItemId>>();
  #added = new Set<RenderItemId>();
  #updated = new Set<RenderItemId>();
  #removed = new Set<RenderItemId>();
  #sorted: readonly RenderItem[] | null = null;
  #revision = 0;
  #subscriptions: Unsubscribe[] = [];

  constructor(editor: GraphEditor, options: SceneOptions = {}) {
    this.#editor = editor;
    this.#options = options;
    const on = <K extends Parameters<GraphEditor['on']>[0]>(
      type: K,
      handler: Parameters<typeof editor.on<K>>[1],
    ): void => {
      this.#subscriptions.push(editor.on(type, handler));
    };
    on('node.created', ({ node }) => this.#refreshNodeAndNeighbors(node.id));
    on('node.updated', ({ node }) => this.#refreshNodeAndNeighbors(node.id));
    on('node.deleted', ({ node }) => this.#refreshNodeAndNeighbors(node.id));
    on('edge.created', ({ edge }) => this.#refreshElement('edge', edge.id));
    on('edge.updated', ({ edge }) => this.#refreshElement('edge', edge.id));
    on('edge.deleted', ({ edge }) => this.#refreshElement('edge', edge.id));
    on('group.created', ({ group }) => this.#refreshGroup(group.id, group.members));
    on('group.updated', ({ group, previous }) =>
      this.#refreshGroup(group.id, [...group.members, ...previous.members]),
    );
    on('group.deleted', ({ group }) => this.#refreshGroup(group.id, group.members));
    this.rebuild();
  }

  /** All render items in paint order (ascending zIndex, then element, then labels last). */
  items(): readonly RenderItem[] {
    if (this.#sorted === null) {
      this.#sorted = [...this.#items.values()].sort(compareRenderItems);
    }
    return this.#sorted;
  }

  /** Monotonic counter bumped on every item change (lazy consumers resync on it). */
  get revision(): number {
    return this.#revision;
  }

  /** Looks a render item up by id. */
  get(id: RenderItemId): RenderItem | undefined {
    return this.#items.get(id);
  }

  /** Render items derived from one model element. */
  itemsForElement(kind: SceneElementKind, elementId: string): readonly RenderItem[] {
    const ids = this.#byElement.get(`${kind}:${elementId}`);
    if (!ids) return [];
    return [...ids].map((id) => this.#items.get(id) as RenderItem);
  }

  /** Number of render items currently in the scene. */
  get size(): number {
    return this.#items.size;
  }

  /** Union bounds of every rendered item (world space); `null` when empty. */
  bounds(): Rect | null {
    let result: Rect | null = null;
    for (const item of this.#items.values()) {
      result = result === null ? item.bounds : unionRects(result, item.bounds);
    }
    return result;
  }

  /** Returns and clears the dirty sets accumulated since the last call. */
  takeDirty(): SceneDirty {
    const dirty: SceneDirty = {
      added: [...this.#added],
      updated: [...this.#updated],
      removed: [...this.#removed],
    };
    this.#added.clear();
    this.#updated.clear();
    this.#removed.clear();
    return dirty;
  }

  /**
   * Re-derives every element from the current model (the full-rebuild
   * fallback). Diffs against existing items, so dirty sets stay minimal and
   * correct even on this path.
   */
  rebuild(): void {
    const graph = this.#editor.graph;
    const live = new Set<string>();
    for (const node of graph.nodes()) live.add(`node:${node.id}`);
    for (const edge of graph.edges()) live.add(`edge:${edge.id}`);
    for (const group of graph.groups()) live.add(`group:${group.id}`);
    // Elements that vanished since the last derivation still hold items.
    for (const key of this.#byElement.keys()) live.add(key);
    for (const key of live) {
      const [kind, id] = key.split(/:(.*)/s) as [SceneElementKind, string];
      this.#refreshElement(kind, id);
    }
  }

  /** Unsubscribes from the editor. The scene stops updating afterwards. */
  destroy(): void {
    for (const off of this.#subscriptions) off();
    this.#subscriptions = [];
  }

  // ---- derivation ---------------------------------------------------------

  #refreshNodeAndNeighbors(nodeId: string): void {
    this.#refreshElement('node', nodeId);
    const { in: incoming, out: outgoing } = this.#editor.graph.edgesOf(nodeId);
    for (const edgeId of incoming) this.#refreshElement('edge', edgeId);
    for (const edgeId of outgoing) this.#refreshElement('edge', edgeId);
    for (const groupId of this.#editor.graph.groupsOf(nodeId)) {
      this.#refreshElement('group', groupId);
    }
  }

  #refreshGroup(groupId: string, memberIds: readonly string[]): void {
    this.#refreshElement('group', groupId);
    const seenEdges = new Set<string>();
    for (const memberId of new Set(memberIds)) {
      this.#refreshElement('node', memberId);
      const { in: incoming, out: outgoing } = this.#editor.graph.edgesOf(memberId);
      for (const edgeId of [...incoming, ...outgoing]) {
        if (!seenEdges.has(edgeId)) {
          seenEdges.add(edgeId);
          this.#refreshElement('edge', edgeId);
        }
      }
    }
  }

  /** Recomputes one element's items from current model state and diffs them in. */
  #refreshElement(kind: SceneElementKind, elementId: string): void {
    const desired = this.#deriveElement(kind, elementId);
    const key = `${kind}:${elementId}`;
    const current = this.#byElement.get(key) ?? new Set<RenderItemId>();
    const desiredIds = new Set(desired.map((item) => item.id));

    for (const id of current) {
      if (!desiredIds.has(id)) {
        this.#items.delete(id);
        this.#markRemoved(id);
      }
    }
    let changed = current.size > desiredIds.size;
    for (const item of desired) {
      const previous = this.#items.get(item.id);
      if (previous === undefined) {
        this.#items.set(item.id, item);
        this.#markAdded(item.id);
        changed = true;
      } else if (JSON.stringify(previous) !== JSON.stringify(item)) {
        this.#items.set(item.id, item);
        this.#markUpdated(item.id);
        changed = true;
      }
    }
    if (desiredIds.size === 0) this.#byElement.delete(key);
    else this.#byElement.set(key, desiredIds);
    if (changed) {
      this.#sorted = null;
      this.#revision++;
    }
  }

  #deriveElement(kind: SceneElementKind, elementId: string): RenderItem[] {
    const graph = this.#editor.graph;
    if (kind === 'node') {
      const node = graph.getNode(elementId);
      return node && this.#nodeVisible(node) ? this.#nodeItems(node) : [];
    }
    if (kind === 'edge') {
      const edge = graph.getEdge(elementId);
      return edge && this.#edgeVisible(edge) ? this.#edgeItems(edge) : [];
    }
    const group = graph.getGroup(elementId);
    return group?.collapsed ? this.#groupItems(group) : [];
  }

  #nodeVisible(node: Node): boolean {
    if (node.hidden) return false;
    for (const groupId of this.#editor.graph.groupsOf(node.id)) {
      if (this.#editor.graph.getGroup(groupId)?.collapsed) return false;
    }
    return true;
  }

  #edgeVisible(edge: Edge): boolean {
    if (edge.hidden) return false;
    const source = this.#editor.graph.getNode(edge.source);
    const target = this.#editor.graph.getNode(edge.target);
    return (
      source !== undefined &&
      target !== undefined &&
      this.#nodeVisible(source) &&
      this.#nodeVisible(target)
    );
  }

  #style(kind: SceneElementKind, element: Node | Edge | Group): ResolvedStyle {
    const base = kind === 'edge' ? DEFAULT_EDGE_STYLE : DEFAULT_NODE_STYLE;
    const overrides = this.#options.styleResolver?.(kind, element);
    return overrides ? { ...base, ...overrides } : base;
  }

  #measure(text: string, style: ResolvedStyle): { width: number; height: number } {
    const measurer = this.#options.measureText ?? estimateTextSize;
    return measurer(text, { fontFamily: style.fontFamily, fontSize: style.fontSize });
  }

  #textItem(
    id: RenderItemId,
    element: SceneElementKind,
    elementId: string,
    layer: SceneLayer,
    zIndex: number,
    text: string,
    position: Point,
    style: ResolvedStyle,
  ): TextRenderItem {
    const size = this.#measure(text, style);
    return {
      id,
      kind: 'text',
      element,
      elementId,
      layer,
      zIndex,
      text,
      position,
      style,
      bounds: {
        x: position.x - size.width / 2,
        y: position.y - size.height / 2,
        width: size.width,
        height: size.height,
      },
    };
  }

  #nodeItems(node: Node): RenderItem[] {
    const style = this.#style('node', node);
    const rect: Rect = {
      x: node.position.x,
      y: node.position.y,
      width: node.size.width,
      height: node.size.height,
    };
    const shape: ShapeRenderItem = {
      id: `node:${node.id}`,
      kind: 'shape',
      element: 'node',
      elementId: node.id,
      layer: 'nodes',
      zIndex: node.zIndex,
      shape: (this.#options.shapeResolver ?? defaultShape)(node),
      rect,
      rotation: node.rotation,
      bounds: rotatedRectBounds(rect, node.rotation),
      style,
    };
    const items: RenderItem[] = [shape];
    const label = node.data['label'];
    if (typeof label === 'string' && label !== '') {
      // Labels stay horizontal even on rotated nodes (readability; P3 decision).
      items.push(
        this.#textItem(
          `label:node:${node.id}`,
          'node',
          node.id,
          'nodes',
          node.zIndex,
          label,
          { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 },
          style,
        ),
      );
    }
    return items;
  }

  #edgeItems(edge: Edge): RenderItem[] {
    const graph = this.#editor.graph;
    const source = graph.getNode(edge.source) as Node;
    const target = graph.getNode(edge.target) as Node;
    const from = edgeAnchor(source, edge.sourcePort);
    const to = edgeAnchor(target, edge.targetPort);
    const style = this.#style('edge', edge);

    let points: readonly Point[];
    if (edge.routing === 'orthogonal') {
      // ponytail: mid-x Z route; real obstacle-avoiding routing is a later phase.
      const midX = (from.x + to.x) / 2;
      points = [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
    } else if (edge.routing === 'bezier') {
      const midX = (from.x + to.x) / 2;
      points = [from, { x: midX, y: from.y }, { x: midX, y: to.y }, to];
    } else {
      points = [from, to];
    }

    const path: PathRenderItem = {
      id: `edge:${edge.id}`,
      kind: 'path',
      element: 'edge',
      elementId: edge.id,
      layer: 'edges',
      zIndex: edge.zIndex,
      routing: edge.routing,
      points,
      // The control polygon contains the Bézier, so these bounds are safe for culling.
      bounds: boundsOfPoints(points),
      style,
    };
    const items: RenderItem[] = [path];
    edge.labels.forEach((label, index) => {
      if (label.text === '') return;
      const at =
        edge.routing === 'bezier'
          ? cubicBezierPoint(
              points[0] as Point,
              points[1] as Point,
              points[2] as Point,
              points[3] as Point,
              label.position,
            )
          : polylinePointAt(points, label.position);
      items.push(
        this.#textItem(
          `label:edge:${edge.id}:${index}`,
          'edge',
          edge.id,
          'edges',
          edge.zIndex,
          label.text,
          at,
          style,
        ),
      );
    });
    return items;
  }

  #groupItems(group: Group): RenderItem[] {
    const graph = this.#editor.graph;
    let bounds: Rect | null = null;
    let zIndex = 0;
    for (const memberId of group.members) {
      const node = graph.getNode(memberId);
      if (!node) continue;
      const nodeBounds = rotatedRectBounds(
        { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height },
        node.rotation,
      );
      bounds = bounds === null ? nodeBounds : unionRects(bounds, nodeBounds);
      if (node.zIndex > zIndex) zIndex = node.zIndex;
    }
    if (bounds === null) return []; // collapsed empty group renders nothing
    const style = this.#style('group', group);
    const proxy: ShapeRenderItem = {
      id: `group:${group.id}`,
      kind: 'shape',
      element: 'group',
      elementId: group.id,
      layer: 'nodes',
      zIndex,
      shape: 'rect',
      rect: bounds,
      rotation: 0,
      bounds,
      style,
    };
    const items: RenderItem[] = [proxy];
    if (group.label !== undefined && group.label !== '') {
      items.push(
        this.#textItem(
          `label:group:${group.id}`,
          'group',
          group.id,
          'nodes',
          zIndex,
          group.label,
          { x: bounds.x + bounds.width / 2, y: bounds.y + bounds.height / 2 },
          style,
        ),
      );
    }
    return items;
  }

  // ---- dirty bookkeeping --------------------------------------------------

  #markAdded(id: RenderItemId): void {
    if (this.#removed.has(id)) {
      // Existed at the last take and reappeared → an update from the
      // renderer's point of view.
      this.#removed.delete(id);
      this.#updated.add(id);
    } else {
      this.#added.add(id);
    }
  }

  #markUpdated(id: RenderItemId): void {
    if (!this.#added.has(id)) this.#updated.add(id);
  }

  #markRemoved(id: RenderItemId): void {
    if (this.#added.has(id)) {
      this.#added.delete(id); // never seen by a renderer → no-op
    } else {
      this.#updated.delete(id);
      this.#removed.add(id);
    }
  }
}

function defaultShape(node: Node): 'rect' | 'ellipse' {
  return node.type === 'ellipse' ? 'ellipse' : 'rect';
}
