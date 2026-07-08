// P4-T11 interaction demo: the full editing loop wired from published
// packages only — engine logic lives in @graphloom/interaction; this file is
// host UI (overlay painting + menu rendering) and stays logic-free.
import { commands, createGraph, type Point } from '@graphloom/core';
import { createClipboard } from '@graphloom/clipboard';
import { createHistory } from '@graphloom/history';
import {
  createSvgRenderer,
  edgeAnchor,
  mountRenderer,
  rotatedRectCorners,
  type Rect,
} from '@graphloom/rendering';
import {
  attachInteraction,
  chordOf,
  handlePositions,
  InteractionEngine,
  type ConnectPreview,
  type NodeTransform,
  type SnapGuide,
} from '@graphloom/interaction';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #app { display: flex; flex-direction: column; height: 100vh; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 8px 16px;
      border-bottom: 1px solid #d4d9e4; background: #f7f9fc; font-size: 14px;
    }
    #stage { position: relative; flex: 1; min-height: 0; }
    #canvas { position: absolute; inset: 0; }
    #overlay { position: absolute; inset: 0; pointer-events: none; overflow: visible; }
    #menu {
      position: absolute; display: none; min-width: 140px; padding: 4px 0;
      background: #fff; border: 1px solid #c6cdda; border-radius: 6px;
      box-shadow: 0 4px 16px rgba(26,31,54,.15); font-size: 13px; z-index: 10;
    }
    #menu button {
      display: block; width: 100%; padding: 5px 14px; border: 0; background: none;
      text-align: left; font: inherit; cursor: pointer;
    }
    #menu button:hover { background: #e8eefc; }
  </style>
  <header>
    <strong>GraphLoom editor</strong>
    <span>selected: <span data-testid="selected">0</span></span>
    <span>nodes: <span data-testid="nodes">0</span></span>
    <span>edges: <span data-testid="edges">0</span></span>
    <span>undo: <span data-testid="can-undo">no</span></span>
    <span style="color:#8892a6">double-click: add node · drag port: connect · right-click: menu</span>
  </header>
  <div id="stage">
    <div id="canvas" data-testid="canvas"></div>
    <svg id="overlay"></svg>
    <div id="menu" data-testid="menu"></div>
  </div>
`;

// ---- editor + engine wiring -------------------------------------------------

const editor = createGraph({ meta: { name: 'Editor demo' } });
const history = createHistory(editor);
const clipboard = createClipboard(editor);

const ports = [
  { id: 'in', side: 'left' as const },
  { id: 'out', side: 'right' as const },
];
editor.transact(() => {
  editor.execute(
    commands.nodeAdd({
      id: 'alpha',
      position: { x: 120, y: 160 },
      size: { width: 120, height: 48 },
      ports,
      data: { label: 'Alpha' },
    }),
  );
  editor.execute(
    commands.nodeAdd({
      id: 'beta',
      position: { x: 420, y: 160 },
      size: { width: 120, height: 48 },
      ports,
      data: { label: 'Beta' },
    }),
  );
  editor.execute(
    commands.nodeAdd({
      id: 'gamma',
      position: { x: 270, y: 340 },
      size: { width: 120, height: 48 },
      ports,
      data: { label: 'Gamma' },
    }),
  );
  editor.execute(
    commands.edgeAdd({ id: 'ab', source: 'alpha', target: 'beta', sourcePort: 'out', targetPort: 'in' }),
  );
});
history.clear(); // seeding is not user work — undo starts empty

const canvas = document.querySelector('#canvas') as HTMLElement;
const host = mountRenderer(editor, createSvgRenderer(), canvas);
const engine = new InteractionEngine(
  { editor, scene: host.scene, viewport: host.viewport, spatial: host.index, history },
  { snap: { gridSize: 20 } },
);
attachInteraction(engine, canvas);

// Double-click on empty canvas creates a node (the demo's palette).
engine.gestures.on('double-tap', ({ point }) => {
  const world = host.viewport.screenToWorld(point);
  if (engine.spatial.hitTest(world)) return; // only on empty canvas
  editor.execute(
    commands.nodeAdd({
      position: { x: world.x - 60, y: world.y - 24 },
      size: { width: 120, height: 48 },
      ports,
      data: { label: 'Node' },
    }),
  );
});

// Clipboard keys are host-wired (the engine keymap owns the rest).
window.addEventListener('keydown', (e) => {
  if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
  const chord = chordOf({ key: e.key, modifiers: { shift: e.shiftKey, ctrl: e.ctrlKey, alt: e.altKey, meta: e.metaKey } });
  if (chord === 'Mod+C') clipboard.copy(engine.selection.ids());
  else if (chord === 'Mod+V') engine.selection.set(clipboard.paste());
  else if (chord === 'Mod+D') engine.selection.set(clipboard.duplicate(engine.selection.ids()));
  else return;
  e.preventDefault();
});

// ---- overlay: selection chrome, previews, marquee, guides -------------------

const overlay = document.querySelector('#overlay') as unknown as SVGSVGElement;
const SVG = 'http://www.w3.org/2000/svg';
let marquee: Rect | null = null;
let guides: readonly SnapGuide[] = [];
let connectPreview: ConnectPreview | null = null;
let transformPreview: { id: string; transform: NodeTransform } | null = null;

const toScreen = (p: Point): Point => host.viewport.worldToScreen(p);

const el = (tag: string, attrs: Record<string, string>): SVGElement => {
  const node = document.createElementNS(SVG, tag);
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  overlay.appendChild(node);
  return node;
};

const outline = (t: NodeTransform, dashed: boolean, cls: string): void => {
  const rect = { x: t.position.x, y: t.position.y, width: t.size.width, height: t.size.height };
  const points = rotatedRectCorners(rect, t.rotation)
    .map((c) => {
      const s = toScreen(c);
      return `${s.x},${s.y}`;
    })
    .join(' ');
  el('polygon', {
    points,
    fill: 'none',
    stroke: '#3b5bd9',
    'stroke-width': '1.5',
    ...(dashed && { 'stroke-dasharray': '4 3' }),
    'data-overlay': cls,
  });
};

function redraw(): void {
  overlay.replaceChildren();
  const dragPreview = engine.drag.preview;

  // Port affordances on every visible node (drag targets for connecting).
  for (const node of editor.graph.nodes()) {
    if (node.hidden) continue;
    for (const port of node.ports) {
      const s = toScreen(edgeAnchor(node, port.id));
      el('circle', {
        cx: String(s.x),
        cy: String(s.y),
        r: '4',
        fill: '#fff',
        stroke: '#3b5bd9',
        'data-overlay': 'port',
        'data-port': `${node.id}:${port.id}`,
      });
    }
  }

  // Selection outlines (at preview positions while dragging).
  for (const id of engine.selection.nodeIds()) {
    const node = editor.graph.getNode(id);
    if (!node) continue;
    const position = dragPreview.get(id) ?? node.position;
    if (transformPreview?.id === id) outline(transformPreview.transform, true, 'transform');
    else outline({ position, size: node.size, rotation: node.rotation }, dragPreview.has(id), 'selection');
  }

  // Handles for a single selected, unlocked node (matches engine hit-testing).
  const ids = engine.selection.nodeIds();
  if (ids.length === 1 && engine.selection.size === 1) {
    const node = editor.graph.getNode(ids[0]!);
    if (node && !node.locked && !engine.drag.active) {
      const zoom = host.viewport.viewport.zoom;
      for (const [handle, world] of Object.entries(handlePositions(node, 24 / zoom))) {
        const s = toScreen(world);
        el('rect', {
          x: String(s.x - 4),
          y: String(s.y - 4),
          width: '8',
          height: '8',
          fill: '#fff',
          stroke: '#3b5bd9',
          'data-overlay': 'handle',
          'data-handle': handle,
        });
      }
    }
  }

  if (marquee) {
    const a = toScreen({ x: marquee.x, y: marquee.y });
    const b = toScreen({ x: marquee.x + marquee.width, y: marquee.y + marquee.height });
    el('rect', {
      x: String(a.x),
      y: String(a.y),
      width: String(b.x - a.x),
      height: String(b.y - a.y),
      fill: 'rgba(59,91,217,.08)',
      stroke: '#3b5bd9',
      'stroke-dasharray': '4 3',
      'data-overlay': 'marquee',
    });
  }

  for (const guide of guides) {
    const s = toScreen({ x: guide.value, y: guide.value });
    const box = canvas.getBoundingClientRect();
    el('line', {
      x1: guide.axis === 'x' ? String(s.x) : '0',
      y1: guide.axis === 'x' ? '0' : String(s.y),
      x2: guide.axis === 'x' ? String(s.x) : String(box.width),
      y2: guide.axis === 'x' ? String(box.height) : String(s.y),
      stroke: '#e0457b',
      'stroke-width': '1',
      'data-overlay': 'guide',
    });
  }

  if (connectPreview) {
    const from = toScreen(connectPreview.from);
    const to = toScreen(connectPreview.to);
    el('line', {
      x1: String(from.x),
      y1: String(from.y),
      x2: String(to.x),
      y2: String(to.y),
      stroke: connectPreview.target ? (connectPreview.valid ? '#2e9e5b' : '#d64545') : '#8892a6',
      'stroke-width': '2',
      'stroke-dasharray': '5 4',
      'data-overlay': 'connect',
      'data-valid': String(connectPreview.valid),
    });
  }
}

engine.selection.on('selection.changed', redraw);
engine.drag.on('drag.preview', redraw);
engine.transform.on('transform.preview', ({ id, transform }) => {
  transformPreview = transform ? { id, transform } : null;
  redraw();
});
engine.on('marquee.changed', ({ rect }) => {
  marquee = rect;
  redraw();
});
engine.snapper?.on('guides.changed', (payload) => {
  guides = payload.guides;
  redraw();
});
engine.connect.on('connect.preview', ({ preview }) => {
  connectPreview = preview;
  redraw();
});
host.viewport.on('viewport.changed', redraw);
editor.on('graph.change', redraw);

// ---- context menu (host-rendered from the typed request) --------------------

const menu = document.querySelector('#menu') as HTMLElement;
const closeMenu = (): void => {
  menu.style.display = 'none';
};
window.addEventListener('pointerdown', (e) => {
  if (!menu.contains(e.target as Node)) closeMenu();
});

engine.on('contextmenu.requested', ({ request }) => {
  menu.replaceChildren();
  const item = (label: string, action: () => void): void => {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.onclick = () => {
      action();
      closeMenu();
    };
    menu.appendChild(button);
  };
  if (request.target.kind === 'node' || request.target.kind === 'edge') {
    engine.selection.set([request.target.id!]);
    item('Delete', () => engine.key({ key: 'Delete', modifiers: { shift: false, ctrl: false, alt: false, meta: false } }));
  } else if (request.target.kind === 'selection') {
    item('Delete selection', () => engine.key({ key: 'Delete', modifiers: { shift: false, ctrl: false, alt: false, meta: false } }));
  } else {
    item('Select all', () => engine.selection.selectAll());
    item('Paste here', () => engine.selection.set(clipboard.paste()));
  }
  for (const entry of request.items) {
    item(String((entry.item as { label?: string }).label ?? entry.key), () => undefined);
  }
  menu.style.left = `${request.screenPoint.x}px`;
  menu.style.top = `${request.screenPoint.y}px`;
  menu.style.display = 'block';
});

// ---- status bar --------------------------------------------------------------

const stat = (id: string): HTMLElement => document.querySelector(`[data-testid="${id}"]`)!;
const showStats = (): void => {
  stat('selected').textContent = String(engine.selection.size);
  stat('nodes').textContent = String(editor.graph.nodeCount);
  stat('edges').textContent = String(editor.graph.edgeCount);
  stat('can-undo').textContent = history.canUndo ? 'yes' : 'no';
};
engine.selection.on('selection.changed', showStats);
editor.on('graph.change', showStats);
history.on('history.changed', showStats);
showStats();
redraw();

// Exposed for the e2e suite (assert model state, not pixels).
declare global {
  interface Window {
    editorDemo: {
      editor: typeof editor;
      engine: typeof engine;
      history: typeof history;
      clipboard: typeof clipboard;
      host: typeof host;
    };
  }
}
window.editorDemo = { editor, engine, history, clipboard, host };
