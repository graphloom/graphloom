import {
  DEFAULT_VISUAL_STATE,
  type Edge,
  type EdgeRouting,
  type GraphEditor,
  type Group,
  type MarkerSpec,
  type Node,
  type PathSegment,
  type Point,
  type ShapeDescriptor,
  type Theme,
  type Unsubscribe,
  type VisualState,
} from '@graphloom/core';
import { lightTheme } from '@graphloom/themes';
import {
  applyToPoint,
  rotatedRectBounds,
  rotationAbout,
  unionRects,
  type Rect,
} from './geometry.js';
import { resolveMarker } from './markers.js';
import {
  createRouters,
  routeBounds,
  routeEdge,
  routePointAt,
  routeTangentAt,
  type EdgeRouter,
  type EdgeSiblings,
} from './routing.js';
import { resolveShapeDescriptor } from './shapes.js';
import { lowerShapeSpec, specAnchorPoint } from './spec.js';
import { estimateTextSize, LINE_HEIGHT, wrapText, type TextMeasurer } from './text.js';

/** Unique id of a render item within a scene (stable across frames). */
export type RenderItemId = string;

/** The renderer layer an item belongs to (ADR-0002 / P3-T07 layer groups). */
export type SceneLayer = 'edges' | 'nodes';

/** Which model element a render item was derived from. */
export type SceneElementKind = 'node' | 'edge' | 'group';

/**
 * Flat, theme-resolved style carried by every render item (ADR-0002: the
 * scene graph resolves theme tokens once; renderers just paint). Optional
 * fields are omitted rather than defaulted so pre-P7 item JSON is preserved.
 */
export interface ResolvedStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
  readonly fontFamily: string;
  readonly fontSize: number;
  readonly textColor: string;
  /** Opacity 0..1 (absent = 1). */
  readonly opacity?: number;
  /** Dash pattern in world units (absent = solid). */
  readonly strokeDasharray?: readonly number[];
  /** Bold text (text items only). */
  readonly bold?: boolean;
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

/**
 * A filled/stroked primitive shape (node bodies, collapsed-group proxies).
 * `rect`/`ellipse`/`roundRect` keep an unrotated rect plus rotation about
 * `pivot` (default: the rect center); `polygon`/`path` geometry is world-
 * baked by the spec lowering (rotation 0).
 */
export interface ShapeRenderItem extends RenderItemBase {
  readonly kind: 'shape';
  readonly shape: 'rect' | 'roundRect' | 'ellipse' | 'polygon' | 'path';
  /** Unrotated rect in world coordinates (bounding box for polygon/path). */
  readonly rect: Rect;
  /** Clockwise degrees about `pivot` (default: the rect center). */
  readonly rotation: number;
  /** Rotation origin when it differs from the rect center (sub-shapes). */
  readonly pivot?: Point;
  /** Corner radius (roundRect only). */
  readonly radius?: number;
  /** World-space vertices (polygon only). */
  readonly points?: readonly Point[];
  /** World-space path segments (path only). */
  readonly segments?: readonly PathSegment[];
}

/** A stroked edge route. */
export interface PathRenderItem extends RenderItemBase {
  readonly kind: 'path';
  readonly routing: EdgeRouting;
  /** Route geometry kind (P7-T05): polyline or cubic chain. */
  readonly curve: 'polyline' | 'cubic';
  /**
   * Polyline: 2+ points. Cubic chain: `3n + 1` points (endpoint, then
   * control/control/endpoint triples) — flatten via geometry helpers for
   * hit tests.
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

/** An image (raster or SVG-by-href) placed in a world rect. */
export interface ImageRenderItem extends RenderItemBase {
  readonly kind: 'image';
  readonly href: string;
  readonly rect: Rect;
  readonly rotation: number;
  readonly pivot?: Point;
}

/** An icon slot (resolved by the host/renderer icon registry). */
export interface IconRenderItem extends RenderItemBase {
  readonly kind: 'icon';
  readonly icon: string;
  readonly rect: Rect;
  readonly rotation: number;
  readonly pivot?: Point;
}

/** A port affordance dot (P7-T03 visibility rules decide when it exists). */
export interface PortRenderItem extends RenderItemBase {
  readonly kind: 'port';
  readonly portId: string;
  readonly center: Point;
  readonly radius: number;
}

/**
 * An edge-end marker (P7-T06): a unit-box path placed at `at`, rotated by
 * `angle` (degrees) and scaled by `size`.
 */
export interface MarkerRenderItem extends RenderItemBase {
  readonly kind: 'marker';
  /** Marker name (library or plugin registry key). */
  readonly marker: string;
  readonly at: Point;
  /** Clockwise degrees; 0 points along +x. */
  readonly angle: number;
  /** World units per unit-box unit. */
  readonly size: number;
  readonly segments: readonly PathSegment[];
  readonly filled: boolean;
}

/** Any render item (ADR-0002 scene graph vocabulary). */
export type RenderItem =
  | ShapeRenderItem
  | PathRenderItem
  | TextRenderItem
  | ImageRenderItem
  | IconRenderItem
  | PortRenderItem
  | MarkerRenderItem;

/** The dirty sets accumulated since the last {@link SceneGraph.takeDirty}. */
export interface SceneDirty {
  readonly added: readonly RenderItemId[];
  readonly updated: readonly RenderItemId[];
  readonly removed: readonly RenderItemId[];
}

/** Options for {@link SceneGraph}. */
export interface SceneOptions {
  /** Theme resolved into every item style (default: the built-in light theme). */
  readonly theme?: Theme;
  /**
   * Shape descriptor registry consulted before the built-in library.
   * Default: the editor's plugin `shapes` registry.
   */
  readonly shapes?: ReadonlyMap<string, ShapeDescriptor>;
  /**
   * Marker registry consulted before the built-in library. Default: the
   * editor's plugin `markers` registry.
   */
  readonly markers?: ReadonlyMap<string, MarkerSpec>;
  /** Edge routers merged over the built-in set (P7-T05 pluggable routing). */
  readonly routers?: ReadonlyMap<string, EdgeRouter>;
  /** Text measurer for label bounds (default: SSR-safe estimator). */
  readonly measureText?: TextMeasurer;
}

const kindRank = { shape: 0, path: 0, image: 0, icon: 0, marker: 1, text: 1, port: 2 } as const;
const layerRank = { edges: 0, nodes: 1 } as const;

/**
 * Paint-order comparator: renderer layer first (edges always under nodes,
 * matching P3-T07's layer groups), then ascending zIndex, then element id,
 * then labels above their shape/path and ports above labels. Shared by scene
 * ordering and top-most hit testing so picking always agrees with pixels
 * (ADR-0002).
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

/**
 * World-space anchor of an edge endpoint: the shape's spec anchor when the
 * descriptor declares one for the port id (P7-T03 dynamic anchors), else the
 * model port's side/offset on the bounding box, else the node center. Tracks
 * node move/resize/rotate by construction — it is evaluated against current
 * node state on every derivation.
 */
export function edgeAnchor(
  node: Node,
  portId: string | undefined,
  spec?: { readonly anchors?: readonly { readonly id: string; readonly position: Point }[] },
): Point {
  if (portId !== undefined) {
    const anchor = spec?.anchors?.find((a) => a.id === portId);
    if (anchor) return specAnchorPoint(node, anchor.position);
  }
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
  return applyToPoint(
    rotationAbout(deg, position.x + size.width / 2, position.y + size.height / 2),
    local,
  );
}

/**
 * Derived, renderer-free description of what to draw (ADR-0002): flattened,
 * z-ordered render items with resolved geometry, transforms, and theme-bound
 * styles. Maintained incrementally from model change events; `rebuild()`
 * re-derives every element from scratch (fallback, test oracle, and the
 * theme-switch path).
 *
 * Node bodies come from Tier-1 shape descriptors (ADR-0003): plugin registry
 * first, then the built-in library, then a rectangle fallback. Edges route
 * through the pluggable router engine (P7-T05). Visual states (P7-T08) are
 * pushed via {@link SceneGraph.setVisualStates} and fed to descriptors.
 *
 * Visibility rules (P3 decisions, see Decision Log): a node renders unless
 * `hidden` or any containing group is collapsed; an edge renders only while
 * both endpoints render; a collapsed group renders one proxy rect (plus
 * label and a member-count badge) over its members' union bounds.
 */
export class SceneGraph {
  #editor: GraphEditor;
  #options: SceneOptions;
  #theme: Theme;
  #shapes: ReadonlyMap<string, ShapeDescriptor>;
  #markers: ReadonlyMap<string, MarkerSpec>;
  #routers: ReadonlyMap<string, EdgeRouter>;
  #states = new Map<string, VisualState>();
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
    this.#theme = options.theme ?? lightTheme;
    this.#shapes = options.shapes ?? editor.registries.shapes;
    this.#markers = options.markers ?? editor.registries.markers;
    const builtin = createRouters();
    this.#routers = options.routers
      ? new Map([...builtin, ...options.routers])
      : builtin;
    const on = <K extends Parameters<GraphEditor['on']>[0]>(
      type: K,
      handler: Parameters<typeof editor.on<K>>[1],
    ): void => {
      this.#subscriptions.push(editor.on(type, handler));
    };
    on('node.created', ({ node }) => this.#refreshNodeAndNeighbors(node.id));
    on('node.updated', ({ node }) => this.#refreshNodeAndNeighbors(node.id));
    on('node.deleted', ({ node }) => this.#refreshNodeAndNeighbors(node.id));
    on('edge.created', ({ edge }) => this.#refreshEdgeAndSiblings(edge));
    on('edge.updated', ({ edge, previous }) => {
      this.#refreshEdgeAndSiblings(previous);
      this.#refreshEdgeAndSiblings(edge);
    });
    on('edge.deleted', ({ edge }) => this.#refreshEdgeAndSiblings(edge));
    on('group.created', ({ group }) => this.#refreshGroup(group.id, group.members));
    on('group.updated', ({ group, previous }) =>
      this.#refreshGroup(group.id, [...group.members, ...previous.members]),
    );
    on('group.deleted', ({ group }) => this.#refreshGroup(group.id, group.members));
    // Shape plugins installed after construction may re-skin existing nodes.
    on('plugin.loaded', () => this.rebuild());
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

  /** The active theme. */
  get theme(): Theme {
    return this.#theme;
  }

  /**
   * Switches the theme and restyles the whole scene (P7-T07): a pure
   * re-derivation — no commands, no model events, nothing enters history.
   */
  setTheme(theme: Theme): void {
    if (theme === this.#theme) return;
    this.#theme = theme;
    this.rebuild();
  }

  /**
   * Replaces the interaction visual states (P7-T08): the map keys are
   * node/edge ids; missing ids are at rest. Affected elements re-derive with
   * the new state fed to their shape descriptors — again history-free.
   */
  setVisualStates(states: ReadonlyMap<string, VisualState>): void {
    const affected = new Set([...this.#states.keys(), ...states.keys()]);
    this.#states = new Map(states);
    for (const id of affected) {
      this.#refreshElement('node', id);
      this.#refreshElement('edge', id);
    }
  }

  /** The visual state of an element (at rest unless pushed). */
  stateOf(elementId: string): VisualState {
    return this.#states.get(elementId) ?? DEFAULT_VISUAL_STATE;
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

  /** An edge change re-fans every sibling between the same node pair. */
  #refreshEdgeAndSiblings(edge: Edge): void {
    for (const siblingId of this.#parallelIds(edge.source, edge.target)) {
      this.#refreshElement('edge', siblingId);
    }
    this.#refreshElement('edge', edge.id);
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

  /** The theme-resolved base style for node-like elements (labels, proxies). */
  #nodeStyle(): ResolvedStyle {
    const { tokens } = this.#theme;
    return {
      fill: tokens.nodeFill,
      stroke: tokens.nodeStroke,
      strokeWidth: tokens.nodeStrokeWidth,
      fontFamily: tokens.fontFamily,
      fontSize: tokens.fontSize,
      textColor: tokens.nodeText,
    };
  }

  /** The theme- and state-resolved style of an edge. */
  #edgeStyle(edge: Edge): ResolvedStyle {
    const { tokens } = this.#theme;
    const state = this.stateOf(edge.id);
    return {
      fill: 'none',
      stroke: state.selected
        ? tokens.selectionStroke
        : state.hovered
          ? tokens.hoverStroke
          : tokens.edgeStroke,
      strokeWidth: state.selected ? tokens.selectionStrokeWidth : tokens.edgeStrokeWidth,
      fontFamily: tokens.fontFamily,
      fontSize: tokens.edgeFontSize,
      textColor: tokens.edgeText,
    };
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

  /** The ShapeSpec of a node under the current theme (state at rest for geometry consumers). */
  #specOf(node: Node, state: VisualState) {
    return resolveShapeDescriptor(node.type, this.#shapes)(node, this.#theme, state);
  }

  #nodeItems(node: Node): RenderItem[] {
    const state = this.stateOf(node.id);
    const spec = this.#specOf(node, state);
    const items = lowerShapeSpec(spec, {
      node,
      theme: this.#theme,
      element: 'node',
      elementId: node.id,
      layer: 'nodes',
      zIndex: node.zIndex,
      baseId: `node:${node.id}`,
      measure: (text, style) => this.#measure(text, { ...this.#nodeStyle(), ...style }),
    });

    const style = this.#nodeStyle();
    const label = node.data['label'];
    if (typeof label === 'string' && label !== '') {
      // Labels stay horizontal even on rotated nodes (readability; P3 decision).
      const rect: Rect = {
        x: node.position.x,
        y: node.position.y,
        width: node.size.width,
        height: node.size.height,
      };
      const outside = node.data['labelPosition'] === 'outside';
      const lineHeight = LINE_HEIGHT * style.fontSize;
      const textStyle = { fontFamily: style.fontFamily, fontSize: style.fontSize };
      const measurer = this.#options.measureText ?? estimateTextSize;
      // Inside labels wrap at the node width (P7-T04 text service); outside
      // labels stay one line below the (rotated) body bounds.
      const maxWidth = Math.max(rect.width - 8, 20);
      const lines =
        !outside && measurer(label, textStyle).width > maxWidth
          ? wrapText(label, maxWidth, textStyle, measurer)
          : [label];
      const bodyBounds = rotatedRectBounds(rect, node.rotation);
      const centerY = outside
        ? bodyBounds.y + bodyBounds.height + 4 + (lines.length * lineHeight) / 2
        : rect.y + rect.height / 2;
      const top = centerY - (lines.length * lineHeight) / 2;
      lines.forEach((line, index) => {
        if (line === '') return;
        items.push(
          this.#textItem(
            index === 0 ? `label:node:${node.id}` : `label:node:${node.id}:l${index}`,
            'node',
            node.id,
            'nodes',
            node.zIndex,
            line,
            { x: rect.x + rect.width / 2, y: top + lineHeight * (index + 0.5) },
            style,
          ),
        );
      });
    }

    // Port affordances (P7-T03 visibility rules).
    const { tokens } = this.#theme;
    for (const port of node.ports) {
      const visibility = port.visibility ?? 'hover';
      const visible = visibility === 'always' || (visibility === 'hover' && state.hovered);
      if (!visible) continue;
      const center = edgeAnchor(node, port.id, spec);
      items.push({
        id: `port:node:${node.id}:${port.id}`,
        kind: 'port',
        element: 'node',
        elementId: node.id,
        layer: 'nodes',
        zIndex: node.zIndex,
        portId: port.id,
        center,
        radius: tokens.portRadius,
        bounds: {
          x: center.x - tokens.portRadius,
          y: center.y - tokens.portRadius,
          width: tokens.portRadius * 2,
          height: tokens.portRadius * 2,
        },
        style: {
          fill: tokens.portFill,
          stroke: tokens.portStroke,
          strokeWidth: tokens.nodeStrokeWidth,
          fontFamily: tokens.fontFamily,
          fontSize: tokens.fontSize,
          textColor: tokens.nodeText,
        },
      });
    }
    return items;
  }

  /** Ids of every edge connecting the same unordered node pair, sorted. */
  #parallelIds(source: string, target: string): string[] {
    const graph = this.#editor.graph;
    const { in: incoming, out: outgoing } = graph.edgesOf(source);
    const ids = new Set<string>();
    for (const edgeId of [...incoming, ...outgoing]) {
      const other = graph.getEdge(edgeId);
      if (!other) continue;
      const pair = other.source === source ? other.target : other.source;
      if (pair === target || (source === target && other.source === other.target)) {
        ids.add(edgeId);
      }
    }
    return [...ids].sort();
  }

  #siblingsOf(edge: Edge): EdgeSiblings {
    const ids = this.#parallelIds(edge.source, edge.target);
    return { index: Math.max(ids.indexOf(edge.id), 0), count: Math.max(ids.length, 1) };
  }

  #edgeItems(edge: Edge): RenderItem[] {
    const graph = this.#editor.graph;
    const source = graph.getNode(edge.source) as Node;
    const target = graph.getNode(edge.target) as Node;
    const sourceSpec = this.#specOf(source, this.stateOf(source.id));
    const targetSpec = this.#specOf(target, this.stateOf(target.id));
    const from = edgeAnchor(source, edge.sourcePort, sourceSpec);
    const to = edgeAnchor(target, edge.targetPort, targetSpec);
    const style = this.#edgeStyle(edge);
    const bounds = (node: Node): Rect =>
      rotatedRectBounds(
        {
          x: node.position.x,
          y: node.position.y,
          width: node.size.width,
          height: node.size.height,
        },
        node.rotation,
      );

    const route = routeEdge(
      edge,
      {
        from,
        to,
        sourceBounds: bounds(source),
        targetBounds: bounds(target),
        siblings: this.#siblingsOf(edge),
      },
      this.#routers,
    );

    const path: PathRenderItem = {
      id: `edge:${edge.id}`,
      kind: 'path',
      element: 'edge',
      elementId: edge.id,
      layer: 'edges',
      zIndex: edge.zIndex,
      routing: edge.routing,
      curve: route.curve,
      points: route.points,
      // The control polygon contains the curve, so these bounds are safe for culling.
      bounds: routeBounds(route),
      style,
    };
    const items: RenderItem[] = [path];

    edge.labels.forEach((label, index) => {
      if (label.text === '') return;
      items.push(
        this.#textItem(
          `label:edge:${edge.id}:${index}`,
          'edge',
          edge.id,
          'edges',
          edge.zIndex,
          label.text,
          routePointAt(route, label.position),
          style,
        ),
      );
    });

    // Edge-end markers (P7-T06): bound via edge.data, theme/state-colored.
    for (const end of ['start', 'end'] as const) {
      const name = edge.data[end === 'start' ? 'markerStart' : 'markerEnd'];
      if (typeof name !== 'string' || name === '') continue;
      const marker = resolveMarker(name, this.#markers);
      if (!marker) continue;
      const at = route.points[end === 'start' ? 0 : route.points.length - 1] as Point;
      // Start markers point out of the path; end markers along it.
      const angle =
        (routeTangentAt(route, end) * 180) / Math.PI + (end === 'start' ? 180 : 0);
      const size = 4 + 4 * style.strokeWidth;
      items.push({
        id: `marker:edge:${edge.id}:${end}`,
        kind: 'marker',
        element: 'edge',
        elementId: edge.id,
        layer: 'edges',
        zIndex: edge.zIndex,
        marker: name,
        at,
        angle,
        size,
        segments: marker.path,
        filled: marker.filled,
        bounds: { x: at.x - size, y: at.y - size, width: size * 2, height: size * 2 },
        style: marker.filled ? { ...style, fill: style.stroke } : style,
      });
    }
    return items;
  }

  #groupItems(group: Group): RenderItem[] {
    const graph = this.#editor.graph;
    let bounds: Rect | null = null;
    let zIndex = 0;
    let members = 0;
    for (const memberId of group.members) {
      const node = graph.getNode(memberId);
      if (!node) continue;
      members++;
      const nodeBounds = rotatedRectBounds(
        { x: node.position.x, y: node.position.y, width: node.size.width, height: node.size.height },
        node.rotation,
      );
      bounds = bounds === null ? nodeBounds : unionRects(bounds, nodeBounds);
      if (node.zIndex > zIndex) zIndex = node.zIndex;
    }
    if (bounds === null) return []; // collapsed empty group renders nothing
    const style = this.#nodeStyle();
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
    // Member-count badge at the proxy's top-right corner (P7-T08). Fractional
    // zIndex keeps it above the proxy without touching model z values.
    const { tokens } = this.#theme;
    const radius = 10;
    const center = { x: bounds.x + bounds.width, y: bounds.y };
    const badgeRect: Rect = {
      x: center.x - radius,
      y: center.y - radius,
      width: radius * 2,
      height: radius * 2,
    };
    items.push(
      {
        id: `badge:group:${group.id}`,
        kind: 'shape',
        element: 'group',
        elementId: group.id,
        layer: 'nodes',
        zIndex: zIndex + 0.5,
        shape: 'ellipse',
        rect: badgeRect,
        rotation: 0,
        bounds: badgeRect,
        style: { ...style, fill: tokens.surfaceFill },
      },
      this.#textItem(
        `badge:group:${group.id}:count`,
        'group',
        group.id,
        'nodes',
        zIndex + 0.5,
        String(members),
        center,
        { ...style, fontSize: Math.min(style.fontSize, 10) },
      ),
    );
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
