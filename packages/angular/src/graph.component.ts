import { NgTemplateOutlet } from '@angular/common';
import {
  ChangeDetectionStrategy,
  Component,
  DestroyRef,
  ElementRef,
  Injector,
  afterNextRender,
  computed,
  contentChildren,
  effect,
  inject,
  input,
  output,
  signal,
  viewChild,
  type OutputEmitterRef,
  type Signal,
  type TemplateRef,
} from '@angular/core';
import { createClipboard, type Clipboard } from '@graphloom/clipboard';
import {
  commands,
  createGraph,
  type GraphEditor,
  type GraphEventMap,
  type GraphLimits,
  type GraphSnapshot,
  type Node,
  type Viewport,
} from '@graphloom/core';
import { createHistory, type History, type HistoryOptions } from '@graphloom/history';
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
import { createGraphSignals, type GraphSignals } from './bridge.js';
import {
  GraphNodeTemplateDirective,
  type GraphNodeTemplateContext,
} from './overlay.js';

/**
 * Construction-time options for {@link GraphComponent}'s wiring. Read once
 * when the editor is created (first browser render); later changes are
 * ignored — recreate the component to rewire.
 */
export interface GraphComponentOptions {
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

/** Everything the component wires per editor instance (all same lifetime). */
interface EditorParts {
  readonly editor: GraphEditor;
  readonly history: History;
  readonly clipboard: Clipboard;
  readonly host: RenderHost;
  readonly engine: InteractionEngine;
  readonly signals: GraphSignals;
  readonly detach: () => void;
}

/** One mounted Tier-2 overlay instance (a visible node with a template). */
interface OverlayEntry {
  readonly node: Node;
  readonly template: TemplateRef<GraphNodeTemplateContext>;
  readonly transform: string;
  readonly width: number;
  readonly height: number;
}

/** Overlay virtualization margin around the viewport, in screen pixels. */
const OVERLAY_MARGIN = 64;

const IDENTITY_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/**
 * The GraphLoom editor as a standalone, zoneless Angular component (P5-T01).
 * Thin by constitution: it only composes the published packages — editor,
 * history, clipboard, SVG renderer, interaction engine — against its host
 * element, and exposes core state as signals. All editing logic lives in the
 * framework-free packages.
 *
 * SSR-safe: the editor is created in `afterNextRender` (browser only); on the
 * server the template renders a placeholder element and never touches
 * `window`/`document` (ADR-0002).
 */
@Component({
  selector: 'graphloom-graph',
  changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [NgTemplateOutlet],
  styles: `
    :host { display: block; position: relative; overflow: hidden; }
    .graphloom-canvas, .graphloom-overlay, .graphloom-placeholder { position: absolute; inset: 0; }
    .graphloom-overlay { pointer-events: none; }
    .graphloom-overlay-node { position: absolute; left: 0; top: 0; transform-origin: 0 0; pointer-events: auto; }
  `,
  template: `
    <div class="graphloom-canvas" #canvas></div>
    @if (ready()) {
      <div class="graphloom-overlay">
        @for (entry of overlays(); track entry.node.id) {
          <div
            class="graphloom-overlay-node"
            [attr.data-node-id]="entry.node.id"
            [style.transform]="entry.transform"
            [style.width.px]="entry.width"
            [style.height.px]="entry.height"
          >
            <ng-container
              [ngTemplateOutlet]="entry.template"
              [ngTemplateOutletContext]="{ $implicit: entry.node }"
            />
          </div>
        }
      </div>
    } @else {
      <div class="graphloom-placeholder" aria-hidden="true"></div>
    }
  `,
})
export class GraphComponent {
  /**
   * Document to load: a {@link GraphSnapshot} replaces the whole graph
   * content in one transaction and clears history (load-not-user-work
   * semantics). `null` leaves the graph untouched.
   */
  readonly document = input<GraphSnapshot | null>(null);
  /** Graph limits (ADR-0007), applied at editor creation only. */
  readonly limits = input<Partial<GraphLimits>>({});
  /** Wiring options, applied at editor creation only. */
  readonly options = input<GraphComponentOptions>({});

  // ---- signal outputs for the core event map (P5-T01) ----------------------
  /** Mirrors `graph.change`. */
  readonly graphChange = output<GraphEventMap['graph.change']>();
  /** Mirrors `node.created`. */
  readonly nodeCreated = output<GraphEventMap['node.created']>();
  /** Mirrors `node.updated`. */
  readonly nodeUpdated = output<GraphEventMap['node.updated']>();
  /** Mirrors `node.deleted`. */
  readonly nodeDeleted = output<GraphEventMap['node.deleted']>();
  /** Mirrors `node.selected`. */
  readonly nodeSelected = output<GraphEventMap['node.selected']>();
  /** Mirrors `edge.created`. */
  readonly edgeCreated = output<GraphEventMap['edge.created']>();
  /** Mirrors `edge.updated`. */
  readonly edgeUpdated = output<GraphEventMap['edge.updated']>();
  /** Mirrors `edge.deleted`. */
  readonly edgeDeleted = output<GraphEventMap['edge.deleted']>();
  /** Mirrors `group.created`. */
  readonly groupCreated = output<GraphEventMap['group.created']>();
  /** Mirrors `group.updated`. */
  readonly groupUpdated = output<GraphEventMap['group.updated']>();
  /** Mirrors `group.deleted`. */
  readonly groupDeleted = output<GraphEventMap['group.deleted']>();
  /** Mirrors `property.changed`. */
  readonly propertyChanged = output<GraphEventMap['property.changed']>();
  /** Mirrors `graph.updated`. */
  readonly graphUpdated = output<GraphEventMap['graph.updated']>();
  /** Mirrors `viewport.changed` (from the viewport controller). */
  readonly viewportChanged = output<GraphEventMap['viewport.changed']>();
  /** Mirrors `layout.completed`. */
  readonly layoutCompleted = output<GraphEventMap['layout.completed']>();
  /** Mirrors `plugin.loaded`. */
  readonly pluginLoaded = output<GraphEventMap['plugin.loaded']>();
  /** Mirrors `limit.warning`. */
  readonly limitWarning = output<GraphEventMap['limit.warning']>();
  /** Mirrors `limit.exceeded`. */
  readonly limitExceeded = output<GraphEventMap['limit.exceeded']>();
  /** Typed context-menu request; the host renders the actual menu UI. */
  readonly contextMenu = output<ContextMenuRequest>();

  // Angular disallows initializer APIs on ES-private (#) members.
  private readonly canvasRef = viewChild.required<ElementRef<HTMLElement>>('canvas');
  private readonly nodeTemplates = contentChildren(GraphNodeTemplateDirective);
  readonly #parts = signal<EditorParts | null>(null);
  readonly #injector = inject(Injector);

  /** True once the editor exists (first browser render; never on server). */
  readonly ready = computed(() => this.#parts() !== null);
  /** All nodes (empty until {@link GraphComponent.ready}). */
  readonly nodes = computed(() => this.#parts()?.signals.nodes() ?? []);
  /** All edges (empty until ready). */
  readonly edges = computed(() => this.#parts()?.signals.edges() ?? []);
  /** All groups (empty until ready). */
  readonly groups = computed(() => this.#parts()?.signals.groups() ?? []);
  /** Selected element ids (empty until ready). */
  readonly selection = computed(() => this.#parts()?.signals.selection() ?? []);
  /** Current pan/zoom state (identity until ready). */
  readonly viewport: Signal<Viewport> = computed(
    () => this.#parts()?.signals.viewport() ?? IDENTITY_VIEWPORT,
  );
  /** Whether undo would do anything. */
  readonly canUndo = computed(() => this.#parts()?.signals.canUndo() ?? false);
  /** Whether redo would do anything. */
  readonly canRedo = computed(() => this.#parts()?.signals.canRedo() ?? false);

  /** Tier-2 overlay instances: visible nodes whose type has a template. */
  readonly overlays = computed<readonly OverlayEntry[]>(() => {
    const parts = this.#parts();
    const templates = this.nodeTemplates();
    if (!parts || templates.length === 0) return [];
    const byType = new Map(
      templates.map((directive) => [directive.nodeType(), directive.template]),
    );
    const { zoom } = parts.signals.viewport();
    const { width, height } = parts.host.viewport.size;
    const entries: OverlayEntry[] = [];
    // ponytail: linear scan — ADR-0007 caps nodes at 500, culling math costs
    // more than it saves here. Revisit with the P9 perf pass if limits grow.
    for (const node of parts.signals.nodes()) {
      if (node.hidden) continue;
      const template = node.type === undefined ? undefined : byType.get(node.type);
      if (!template) continue;
      const screen = parts.host.viewport.worldToScreen(node.position);
      const outside =
        screen.x + node.size.width * zoom < -OVERLAY_MARGIN ||
        screen.y + node.size.height * zoom < -OVERLAY_MARGIN ||
        screen.x > width + OVERLAY_MARGIN ||
        screen.y > height + OVERLAY_MARGIN;
      if (outside) continue; // virtualized: off-viewport instances are destroyed
      entries.push({
        node,
        template,
        // ponytail: overlay nodes ignore node.rotation — rotate HTML overlays
        // when a real use case shows up (Tier 1 shapes do rotate).
        transform: `translate(${screen.x}px, ${screen.y}px) scale(${zoom})`,
        width: node.size.width,
        height: node.size.height,
      });
    }
    return entries;
  });

  constructor() {
    afterNextRender(() => this.#initialize());
    inject(DestroyRef).onDestroy(() => this.#teardown());
  }

  /** The live editor, or `null` before the first browser render. */
  editor(): GraphEditor | null {
    return this.#parts()?.editor ?? null;
  }

  /** The undo/redo service, or `null` before the first browser render. */
  history(): History | null {
    return this.#parts()?.history ?? null;
  }

  /** The clipboard service, or `null` before the first browser render. */
  clipboard(): Clipboard | null {
    return this.#parts()?.clipboard ?? null;
  }

  /** The interaction engine, or `null` before the first browser render. */
  engine(): InteractionEngine | null {
    return this.#parts()?.engine ?? null;
  }

  /** The rendering pipeline, or `null` before the first browser render. */
  host(): RenderHost | null {
    return this.#parts()?.host ?? null;
  }

  #initialize(): void {
    const canvas = this.canvasRef().nativeElement;
    const options = this.options();
    const editor = createGraph({ limits: this.limits() });
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
    const signals = createGraphSignals({
      editor,
      selection: engine.selection,
      viewport: host.viewport,
      history,
    });

    const forward = <K extends keyof GraphEventMap>(
      type: K,
      out: OutputEmitterRef<GraphEventMap[K]>,
    ): void => {
      editor.on(type, (payload) => out.emit(payload));
    };
    forward('graph.change', this.graphChange);
    forward('node.created', this.nodeCreated);
    forward('node.updated', this.nodeUpdated);
    forward('node.deleted', this.nodeDeleted);
    forward('node.selected', this.nodeSelected);
    forward('edge.created', this.edgeCreated);
    forward('edge.updated', this.edgeUpdated);
    forward('edge.deleted', this.edgeDeleted);
    forward('group.created', this.groupCreated);
    forward('group.updated', this.groupUpdated);
    forward('group.deleted', this.groupDeleted);
    forward('property.changed', this.propertyChanged);
    forward('graph.updated', this.graphUpdated);
    forward('layout.completed', this.layoutCompleted);
    forward('plugin.loaded', this.pluginLoaded);
    forward('limit.warning', this.limitWarning);
    forward('limit.exceeded', this.limitExceeded);
    host.viewport.on('viewport.changed', (payload) => this.viewportChanged.emit(payload));
    engine.on('contextmenu.requested', ({ request }) => this.contextMenu.emit(request));

    this.#parts.set({ editor, history, clipboard, host, engine, signals, detach });

    // Loads the document now and reloads whenever the input changes.
    effect(
      () => {
        const snapshot = this.document();
        if (snapshot) this.#load(editor, history, snapshot);
      },
      { injector: this.#injector },
    );
  }

  /** Replaces graph content with the snapshot; loading is not user work. */
  #load(editor: GraphEditor, history: History, snapshot: GraphSnapshot): void {
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

  #teardown(): void {
    const parts = this.#parts();
    if (!parts) return;
    parts.detach();
    parts.signals.destroy();
    parts.history.dispose();
    parts.host.destroy();
    this.#parts.set(null);
  }
}
