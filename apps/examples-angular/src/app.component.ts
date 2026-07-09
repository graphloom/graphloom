// P5 close-out demo: the full editing loop through @graphloom/angular.
// The wrapper composes the editor; this file is host UI only (status bar,
// context menu, Tier-2 card overlay, palette dblclick, clipboard chords).
import { Component, effect, signal, viewChild } from '@angular/core';
import { GraphComponent, GraphNodeTemplateDirective } from '@graphloom/angular';
import { commands, createGraph, type GraphSnapshot, type Node } from '@graphloom/core';
import { chordOf, type ContextMenuRequest } from '@graphloom/interaction';

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };

/** Same geometry as the vanilla editor demo (e2e math stays familiar). */
const seed = (): GraphSnapshot => {
  const scratch = createGraph({ meta: { name: 'Angular editor demo' } });
  const ports = [
    { id: 'in', side: 'left' as const },
    { id: 'out', side: 'right' as const },
  ];
  scratch.transact(() => {
    scratch.execute(
      commands.nodeAdd({
        id: 'alpha',
        position: { x: 120, y: 160 },
        size: { width: 120, height: 48 },
        ports,
        data: { label: 'Alpha' },
      }),
    );
    scratch.execute(
      commands.nodeAdd({
        id: 'beta',
        position: { x: 420, y: 160 },
        size: { width: 120, height: 48 },
        ports,
        data: { label: 'Beta' },
      }),
    );
    scratch.execute(
      commands.nodeAdd({
        id: 'gamma',
        type: 'card',
        position: { x: 270, y: 340 },
        size: { width: 120, height: 48 },
        ports,
        data: { label: 'Gamma card' },
      }),
    );
    scratch.execute(
      commands.edgeAdd({ id: 'ab', source: 'alpha', target: 'beta', sourcePort: 'out', targetPort: 'in' }),
    );
  });
  return scratch.snapshot();
};

@Component({
  selector: 'app-root',
  imports: [GraphComponent, GraphNodeTemplateDirective],
  host: {
    '(document:pointerdown)': 'onDocumentPointerDown($event)',
    '(document:keydown)': 'onDocumentKeydown($event)',
  },
  styles: `
    :host { display: flex; flex-direction: column; height: 100vh; font-family: system-ui, sans-serif; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 8px 16px;
      border-bottom: 1px solid #d4d9e4; background: #f7f9fc; font-size: 14px;
    }
    main { position: relative; flex: 1; min-height: 0; }
    graphloom-graph { position: absolute; inset: 0; }
    .card {
      box-sizing: border-box; width: 100%; height: 100%; display: flex;
      align-items: center; justify-content: center; border: 2px solid #3b5bd9;
      border-radius: 8px; background: #eef2ff; font-size: 13px; color: #1a1f36;
    }
    .menu {
      position: absolute; min-width: 140px; padding: 4px 0; background: #fff;
      border: 1px solid #c6cdda; border-radius: 6px; font-size: 13px; z-index: 10;
      box-shadow: 0 4px 16px rgba(26, 31, 54, 0.15);
    }
    .menu button {
      display: block; width: 100%; padding: 5px 14px; border: 0; background: none;
      text-align: left; font: inherit; cursor: pointer;
    }
    .menu button:hover { background: #e8eefc; }
  `,
  template: `
    <header>
      <strong>GraphLoom Angular editor</strong>
      <span>selected: <span data-testid="selected">{{ graph().selection().length }}</span></span>
      <span>nodes: <span data-testid="nodes">{{ graph().nodes().length }}</span></span>
      <span>edges: <span data-testid="edges">{{ graph().edges().length }}</span></span>
      <span>undo: <span data-testid="can-undo">{{ graph().canUndo() ? 'yes' : 'no' }}</span></span>
      <span style="color:#5a6478">double-click: add node · drag port: connect · right-click: menu</span>
    </header>
    <main>
      <graphloom-graph data-testid="graph" [document]="doc" (contextMenu)="menu.set($event)">
        <ng-template graphloomNode="card" let-node>
          <div class="card">{{ label(node) }}</div>
        </ng-template>
      </graphloom-graph>
      @if (menu(); as request) {
        <div
          class="menu"
          data-testid="menu"
          [style.left.px]="request.screenPoint.x"
          [style.top.px]="request.screenPoint.y"
        >
          @if (request.target.kind === 'canvas') {
            <button type="button" (click)="selectAll()">Select all</button>
          } @else {
            <button type="button" data-testid="menu-delete" (click)="deleteTarget(request)">
              Delete
            </button>
          }
        </div>
      }
    </main>
  `,
})
export class AppComponent {
  readonly doc = seed();
  readonly menu = signal<ContextMenuRequest | null>(null);
  readonly graph = viewChild.required(GraphComponent);

  constructor() {
    // Demo wiring the moment the editor exists (browser only).
    effect(() => {
      const graph = this.graph();
      const engine = graph.engine();
      if (!engine) return;

      // Palette: double-click on empty canvas creates a node.
      engine.gestures.on('double-tap', ({ point }) => {
        const world = graph.host()!.viewport.screenToWorld(point);
        if (engine.spatial.hitTest(world)) return;
        graph.editor()!.execute(
          commands.nodeAdd({
            position: { x: world.x - 60, y: world.y - 24 },
            size: { width: 120, height: 48 },
            ports: [
              { id: 'in', side: 'left' },
              { id: 'out', side: 'right' },
            ],
            data: { label: 'Node' },
          }),
        );
      });

      // Exposed for the e2e suite (assert model state, not pixels).
      window.angularDemo = {
        editor: graph.editor()!,
        engine,
        history: graph.history()!,
        clipboard: graph.clipboard()!,
        host: graph.host()!,
      };
    });
  }

  label(node: Node): string {
    return String((node.data as { label?: string } | undefined)?.label ?? node.id);
  }

  selectAll(): void {
    this.graph().engine()!.selection.selectAll();
    this.menu.set(null);
  }

  deleteTarget(request: ContextMenuRequest): void {
    const engine = this.graph().engine()!;
    if ((request.target.kind === 'node' || request.target.kind === 'edge') && request.target.id) {
      engine.selection.set([request.target.id]);
    }
    engine.key({ key: 'Delete', modifiers: NO_MODIFIERS });
    this.menu.set(null);
  }

  onDocumentPointerDown(event: Event): void {
    if (!(event.target instanceof Element) || !event.target.closest('.menu')) this.menu.set(null);
  }

  // Clipboard chords are host-wired (the engine keymap owns the rest).
  onDocumentKeydown(event: KeyboardEvent): void {
    if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
      return;
    }
    const graph = this.graph();
    const engine = graph.engine();
    const clipboard = graph.clipboard();
    if (!engine || !clipboard) return;
    const chord = chordOf({
      key: event.key,
      modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey },
    });
    if (chord === 'Mod+C') clipboard.copy(engine.selection.ids());
    else if (chord === 'Mod+V') engine.selection.set(clipboard.paste());
    else if (chord === 'Mod+D') engine.selection.set(clipboard.duplicate(engine.selection.ids()));
    else return;
    event.preventDefault();
  }
}

declare global {
  interface Window {
    angularDemo: {
      editor: NonNullable<ReturnType<GraphComponent['editor']>>;
      engine: NonNullable<ReturnType<GraphComponent['engine']>>;
      history: NonNullable<ReturnType<GraphComponent['history']>>;
      clipboard: NonNullable<ReturnType<GraphComponent['clipboard']>>;
      host: NonNullable<ReturnType<GraphComponent['host']>>;
    };
  }
}
