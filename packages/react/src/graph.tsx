import { createClipboard, type Clipboard } from '@graphloom/clipboard';
import {
  commands,
  createGraph,
  type GraphEditor,
  type GraphEventMap,
  type GraphLimits,
  type GraphSnapshot,
  type Node,
} from '@graphloom/core';
import {
  createHistory,
  type History,
  type HistoryOptions,
} from '@graphloom/history';
import {
  InteractionEngine,
  attachInteraction,
  type AttachOptions,
  type ContextMenuRequest,
  type InteractionEngineOptions,
} from '@graphloom/interaction';
import {
  createSvgRenderer,
  mountRenderer,
  type MountOptions,
  type RenderHost,
  type SvgRendererOptions,
} from '@graphloom/rendering';
import {
  createContext,
  useEffect,
  useImperativeHandle,
  useRef,
  useState,
  useSyncExternalStore,
  type CSSProperties,
  type ComponentType,
  type ReactNode,
  type Ref,
} from 'react';
import { createGraphStore, type GraphStore } from './store.js';

/**
 * Construction-time options for {@link Graph}'s wiring. Read once when the
 * editor is created (first client effect); later changes are ignored —
 * remount the component to rewire.
 */
export interface GraphOptions {
  /** Rendering pipeline knobs (scene, viewport, frame). */
  readonly mount?: MountOptions;
  /** Interaction engine knobs (snap, keymap, drag, …). */
  readonly engine?: InteractionEngineOptions;
  /** DOM adapter knobs (keyboard target, context-menu suppression). */
  readonly attach?: AttachOptions;
  /** SVG renderer knobs. */
  readonly renderer?: SvgRendererOptions;
  /** Undo/redo knobs (stack depth, coalescing). */
  readonly history?: HistoryOptions;
}

/** Everything {@link Graph} wires per editor instance (all same lifetime). */
export interface GraphParts {
  /** The live command-driven editor. */
  readonly editor: GraphEditor;
  /** The undo/redo service. */
  readonly history: History;
  /** The copy/paste service. */
  readonly clipboard: Clipboard;
  /** The mounted rendering pipeline. */
  readonly host: RenderHost;
  /** The interaction engine. */
  readonly engine: InteractionEngine;
  /** The `useSyncExternalStore` bridge over the editor's event stream. */
  readonly store: GraphStore;
}

/**
 * The imperative surface exposed through {@link GraphProps.ref}. Every member
 * is `null` until the editor exists (first client effect; never on the
 * server).
 */
export interface GraphHandle {
  /** The live editor, or `null` before the first client effect. */
  readonly editor: GraphEditor | null;
  /** The undo/redo service, or `null` before the first client effect. */
  readonly history: History | null;
  /** The copy/paste service, or `null` before the first client effect. */
  readonly clipboard: Clipboard | null;
  /** The interaction engine, or `null` before the first client effect. */
  readonly engine: InteractionEngine | null;
  /** The rendering pipeline, or `null` before the first client effect. */
  readonly host: RenderHost | null;
}

/** Props received by a Tier-2 overlay node component (ADR-0003). */
export interface OverlayNodeProps {
  /** The model node this overlay instance renders. */
  readonly node: Node;
}

/** Event callback props mirroring the core event map (P6-T01). */
export interface GraphEventProps {
  /** Mirrors `graph.change`. */
  readonly onGraphChange?: (payload: GraphEventMap['graph.change']) => void;
  /** Mirrors `node.created`. */
  readonly onNodeCreated?: (payload: GraphEventMap['node.created']) => void;
  /** Mirrors `node.updated`. */
  readonly onNodeUpdated?: (payload: GraphEventMap['node.updated']) => void;
  /** Mirrors `node.deleted`. */
  readonly onNodeDeleted?: (payload: GraphEventMap['node.deleted']) => void;
  /** Mirrors `node.selected`. */
  readonly onNodeSelected?: (payload: GraphEventMap['node.selected']) => void;
  /** Mirrors `edge.created`. */
  readonly onEdgeCreated?: (payload: GraphEventMap['edge.created']) => void;
  /** Mirrors `edge.updated`. */
  readonly onEdgeUpdated?: (payload: GraphEventMap['edge.updated']) => void;
  /** Mirrors `edge.deleted`. */
  readonly onEdgeDeleted?: (payload: GraphEventMap['edge.deleted']) => void;
  /** Mirrors `group.created`. */
  readonly onGroupCreated?: (payload: GraphEventMap['group.created']) => void;
  /** Mirrors `group.updated`. */
  readonly onGroupUpdated?: (payload: GraphEventMap['group.updated']) => void;
  /** Mirrors `group.deleted`. */
  readonly onGroupDeleted?: (payload: GraphEventMap['group.deleted']) => void;
  /** Mirrors `property.changed`. */
  readonly onPropertyChanged?: (payload: GraphEventMap['property.changed']) => void;
  /** Mirrors `graph.updated`. */
  readonly onGraphUpdated?: (payload: GraphEventMap['graph.updated']) => void;
  /** Mirrors `viewport.changed` (from the viewport controller). */
  readonly onViewportChanged?: (payload: GraphEventMap['viewport.changed']) => void;
  /** Mirrors `layout.completed`. */
  readonly onLayoutCompleted?: (payload: GraphEventMap['layout.completed']) => void;
  /** Mirrors `plugin.loaded`. */
  readonly onPluginLoaded?: (payload: GraphEventMap['plugin.loaded']) => void;
  /** Mirrors `limit.warning`. */
  readonly onLimitWarning?: (payload: GraphEventMap['limit.warning']) => void;
  /** Mirrors `limit.exceeded`. */
  readonly onLimitExceeded?: (payload: GraphEventMap['limit.exceeded']) => void;
  /** Typed context-menu request; the host renders the actual menu UI. */
  readonly onContextMenu?: (request: ContextMenuRequest) => void;
}

/** Props for the {@link Graph} component (P6-T01). */
export interface GraphProps extends GraphEventProps {
  /**
   * Document to load: a {@link GraphSnapshot} replaces the whole graph
   * content in one transaction and clears history (load-not-user-work
   * semantics). Reloads when the prop identity changes; `null` leaves the
   * graph untouched.
   */
  readonly document?: GraphSnapshot | null;
  /** Graph limits (ADR-0007), applied at editor creation only. */
  readonly limits?: Partial<GraphLimits>;
  /** Wiring options, applied at editor creation only. */
  readonly options?: GraphOptions;
  /**
   * Tier-2 overlay components by node `type` (ADR-0003 escape hatch): each
   * visible node whose `type` has an entry renders that component in an HTML
   * overlay layer above the canvas, positioned by core viewport math and
   * virtualized to the viewport (plus margin).
   */
  readonly nodeTypes?: Readonly<Record<string, ComponentType<OverlayNodeProps>>>;
  /** Extra UI (toolbars, panels) rendered inside the graph's context. */
  readonly children?: ReactNode;
  /** Class for the outer container element. */
  readonly className?: string;
  /** Inline style merged over the container's positioning defaults. */
  readonly style?: CSSProperties;
  /** Imperative access to the wired services (React 19 ref-as-prop). */
  readonly ref?: Ref<GraphHandle>;
}

/**
 * Context carrying the live editor parts to the hooks (`useGraph`,
 * `useSelection`, …). `undefined` means "outside a {@link Graph}"; `null`
 * means "inside, but the editor doesn't exist yet" (server, first render).
 */
export const GraphContext = createContext<GraphParts | null | undefined>(undefined);

/** Overlay virtualization margin around the viewport, in screen pixels. */
const OVERLAY_MARGIN = 64;

const CONTAINER_STYLE: CSSProperties = {
  display: 'block',
  position: 'relative',
  overflow: 'hidden',
};
const FILL_STYLE: CSSProperties = { position: 'absolute', inset: 0 };
const OVERLAY_STYLE: CSSProperties = { ...FILL_STYLE, pointerEvents: 'none' };

/**
 * The GraphLoom editor as a React 19 component (P6-T01). Thin by
 * constitution: it only composes the published packages — editor, history,
 * clipboard, SVG renderer, interaction engine — against its host element and
 * exposes core state through {@link GraphContext}. All editing logic lives in
 * the framework-free packages.
 *
 * StrictMode-safe: everything is created in one effect and destroyed in its
 * cleanup, so the dev-mode mount→unmount→mount cycle leaves exactly one live
 * editor. SSR-safe: effects never run on the server, so the server renders
 * only the empty container/canvas divs and hydration finds identical markup
 * (ADR-0002).
 */
export function Graph(props: GraphProps): ReactNode {
  const { document: doc = null, nodeTypes, children, className, style } = props;
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const [parts, setParts] = useState<GraphParts | null>(null);
  // Latest props, so event subscriptions wired once still see fresh callbacks.
  const propsRef = useRef(props);
  propsRef.current = props;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return undefined;
    const { limits = {}, options = {} } = propsRef.current;
    const editor = createGraph({ limits });
    const history = createHistory(editor, options.history);
    const clipboard = createClipboard(editor);
    const host = mountRenderer(
      editor,
      createSvgRenderer(options.renderer),
      canvas,
      options.mount,
    );
    const engine = new InteractionEngine(
      { editor, scene: host.scene, viewport: host.viewport, spatial: host.index, history },
      options.engine,
    );
    const detach = attachInteraction(engine, canvas, options.attach);
    const store = createGraphStore({
      editor,
      selection: engine.selection,
      viewport: host.viewport,
      history,
    });

    const forward = <K extends keyof GraphEventMap>(
      type: K,
      pick: (cbs: GraphEventProps) => ((payload: GraphEventMap[K]) => void) | undefined,
    ): void => {
      editor.on(type, (payload) => pick(propsRef.current)?.(payload));
    };
    forward('graph.change', (cbs) => cbs.onGraphChange);
    forward('node.created', (cbs) => cbs.onNodeCreated);
    forward('node.updated', (cbs) => cbs.onNodeUpdated);
    forward('node.deleted', (cbs) => cbs.onNodeDeleted);
    forward('node.selected', (cbs) => cbs.onNodeSelected);
    forward('edge.created', (cbs) => cbs.onEdgeCreated);
    forward('edge.updated', (cbs) => cbs.onEdgeUpdated);
    forward('edge.deleted', (cbs) => cbs.onEdgeDeleted);
    forward('group.created', (cbs) => cbs.onGroupCreated);
    forward('group.updated', (cbs) => cbs.onGroupUpdated);
    forward('group.deleted', (cbs) => cbs.onGroupDeleted);
    forward('property.changed', (cbs) => cbs.onPropertyChanged);
    forward('graph.updated', (cbs) => cbs.onGraphUpdated);
    forward('layout.completed', (cbs) => cbs.onLayoutCompleted);
    forward('plugin.loaded', (cbs) => cbs.onPluginLoaded);
    forward('limit.warning', (cbs) => cbs.onLimitWarning);
    forward('limit.exceeded', (cbs) => cbs.onLimitExceeded);
    host.viewport.on('viewport.changed', (payload) =>
      propsRef.current.onViewportChanged?.(payload),
    );
    engine.on('contextmenu.requested', ({ request }) =>
      propsRef.current.onContextMenu?.(request),
    );

    setParts({ editor, history, clipboard, host, engine, store });
    return () => {
      setParts(null);
      detach();
      store.destroy();
      history.dispose();
      host.destroy(); // editor listeners die with the editor instance
    };
  }, []);

  // Loads the document now and reloads whenever the prop identity changes.
  useEffect(() => {
    if (parts && doc) loadSnapshot(parts.editor, parts.history, doc);
  }, [parts, doc]);

  useImperativeHandle(
    props.ref,
    () => ({
      editor: parts?.editor ?? null,
      history: parts?.history ?? null,
      clipboard: parts?.clipboard ?? null,
      engine: parts?.engine ?? null,
      host: parts?.host ?? null,
    }),
    [parts],
  );

  return (
    <div className={className} style={{ ...CONTAINER_STYLE, ...style }}>
      <div ref={canvasRef} data-graphloom-canvas="" style={FILL_STYLE} />
      <GraphContext.Provider value={parts}>
        {parts && nodeTypes ? <OverlayLayer parts={parts} nodeTypes={nodeTypes} /> : null}
        {children}
      </GraphContext.Provider>
    </div>
  );
}

/** Replaces graph content with the snapshot; loading is not user work. */
function loadSnapshot(
  editor: GraphEditor,
  history: History,
  snapshot: GraphSnapshot,
): void {
  editor.transact(() => {
    for (const group of [...editor.graph.groups()]) {
      editor.execute(commands.groupDissolve(group.id));
    }
    for (const edge of [...editor.graph.edges()]) {
      editor.execute(commands.edgeRemove(edge.id));
    }
    for (const node of [...editor.graph.nodes()]) {
      editor.execute(commands.nodeRemove(node.id));
    }
    for (const node of snapshot.nodes) editor.execute(commands.nodeAdd(node));
    for (const edge of snapshot.edges) editor.execute(commands.edgeAdd(edge));
    for (const group of snapshot.groups) {
      editor.execute(commands.groupCreate(group));
    }
  });
  history.clear();
}

interface OverlayLayerProps {
  readonly parts: GraphParts;
  readonly nodeTypes: Readonly<Record<string, ComponentType<OverlayNodeProps>>>;
}

/**
 * Tier-2 overlay layer (P6-T03, ADR-0003): stamps one component instance per
 * visible node whose `type` has an entry in `nodeTypes`, positioned from core
 * viewport math. Entries are keyed by node id, so a component instance (and
 * its state) survives pan/zoom while visible; off-viewport instances are
 * unmounted (virtualization).
 */
function OverlayLayer({ parts, nodeTypes }: OverlayLayerProps): ReactNode {
  const { store, host } = parts;
  const nodes = useSyncExternalStore(store.subscribe, () => store.getState().nodes);
  const { zoom } = useSyncExternalStore(store.subscribe, () => store.getState().viewport);
  const { width, height } = host.viewport.size;
  const entries: ReactNode[] = [];
  // ponytail: linear scan — ADR-0007 caps nodes at 500, culling math costs
  // more than it saves here. Revisit with the P9 perf pass if limits grow.
  for (const node of nodes) {
    if (node.hidden) continue;
    const Overlay = node.type === undefined ? undefined : nodeTypes[node.type];
    if (!Overlay) continue;
    const screen = host.viewport.worldToScreen(node.position);
    const outside =
      screen.x + node.size.width * zoom < -OVERLAY_MARGIN ||
      screen.y + node.size.height * zoom < -OVERLAY_MARGIN ||
      screen.x > width + OVERLAY_MARGIN ||
      screen.y > height + OVERLAY_MARGIN;
    if (outside) continue; // virtualized: off-viewport instances are destroyed
    entries.push(
      <div
        key={node.id}
        data-node-id={node.id}
        style={{
          position: 'absolute',
          left: 0,
          top: 0,
          transformOrigin: '0 0',
          pointerEvents: 'auto',
          // ponytail: overlay nodes ignore node.rotation — rotate HTML
          // overlays when a real use case shows up (Tier 1 shapes do rotate).
          transform: `translate(${screen.x}px, ${screen.y}px) scale(${zoom})`,
          width: node.size.width,
          height: node.size.height,
        }}
      >
        <Overlay node={node} />
      </div>,
    );
  }
  return (
    <div data-graphloom-overlay="" style={OVERLAY_STYLE}>
      {entries}
    </div>
  );
}
