// P6 close-out demo: the full editing loop through @graphloom/react under
// StrictMode. The wrapper composes the editor; this file is host UI only
// (status bar, context menu, Tier-2 card overlay, palette dblclick,
// clipboard chords).
import { commands, createGraph, type GraphSnapshot, type Node } from '@graphloom/core';
import { chordOf, type ContextMenuRequest } from '@graphloom/interaction';
import {
  Graph,
  useGraph,
  useSelection,
  useUndoRedo,
  type GraphParts,
  type OverlayNodeProps,
} from '@graphloom/react';
import { useCallback, useEffect, useState, type CSSProperties, type ReactNode } from 'react';

const NO_MODIFIERS = { shift: false, ctrl: false, alt: false, meta: false };

/** Same geometry as the vanilla/Angular editor demos (e2e math stays familiar). */
const seed = (): GraphSnapshot => {
  const scratch = createGraph({ meta: { name: 'React editor demo' } });
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

const DOC = seed(); // stable identity: the document loads exactly once

const label = (node: Node): string =>
  String((node.data as { label?: string } | undefined)?.label ?? node.id);

const CARD_STYLE: CSSProperties = {
  boxSizing: 'border-box',
  width: '100%',
  height: '100%',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  border: '2px solid #3b5bd9',
  borderRadius: 8,
  background: '#eef2ff',
  fontSize: 13,
  color: '#1a1f36',
};

const HEADER_STYLE: CSSProperties = {
  position: 'absolute',
  top: 0,
  left: 0,
  right: 0,
  display: 'flex',
  alignItems: 'center',
  gap: 12,
  padding: '8px 16px',
  borderBottom: '1px solid #d4d9e4',
  background: '#f7f9fc',
  fontSize: 14,
  zIndex: 5,
};

const MENU_STYLE: CSSProperties = {
  position: 'absolute',
  minWidth: 140,
  padding: '4px 0',
  background: '#fff',
  border: '1px solid #c6cdda',
  borderRadius: 6,
  fontSize: 13,
  zIndex: 10,
  boxShadow: '0 4px 16px rgba(26, 31, 54, 0.15)',
};

const MENU_BUTTON_STYLE: CSSProperties = {
  display: 'block',
  width: '100%',
  padding: '5px 14px',
  border: 0,
  background: 'none',
  textAlign: 'left',
  font: 'inherit',
  cursor: 'pointer',
};

/** Tier-2 overlay for `type: 'card'` nodes. */
const Card = ({ node }: OverlayNodeProps): ReactNode => (
  <div style={CARD_STYLE}>{label(node)}</div>
);

interface ChromeProps {
  readonly menu: ContextMenuRequest | null;
  readonly closeMenu: () => void;
}

/**
 * Editor chrome, rendered inside <Graph> (the hooks need its context):
 * status bar, context menu, palette dblclick, clipboard chords, e2e handle.
 */
const Chrome = ({ menu, closeMenu }: ChromeProps): ReactNode => {
  const { ready, nodes, edges, editor, engine, history, clipboard, host } = useGraph();
  const selection = useSelection();
  const { canUndo } = useUndoRedo();

  useEffect(() => {
    if (!editor || !engine || !history || !clipboard || !host) return undefined;

    // Palette: double-click on empty canvas creates a node.
    const offDoubleTap = engine.gestures.on('double-tap', ({ point }) => {
      const world = host.viewport.screenToWorld(point);
      if (engine.spatial.hitTest(world)) return;
      editor.execute(
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
    window.reactDemo = { editor, engine, history, clipboard, host };

    const onPointerDown = (event: Event): void => {
      if (!(event.target instanceof Element) || !event.target.closest('[data-testid="menu"]')) {
        closeMenu();
      }
    };
    // Clipboard chords are host-wired (the engine keymap owns the rest).
    const onKeydown = (event: KeyboardEvent): void => {
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) {
        return;
      }
      const chord = chordOf({
        key: event.key,
        modifiers: { shift: event.shiftKey, ctrl: event.ctrlKey, alt: event.altKey, meta: event.metaKey },
      });
      if (chord === 'Mod+C') clipboard.copy(engine.selection.ids());
      else if (chord === 'Mod+V') engine.selection.set(clipboard.paste());
      else if (chord === 'Mod+D') engine.selection.set(clipboard.duplicate(engine.selection.ids()));
      else return;
      event.preventDefault();
    };
    document.addEventListener('pointerdown', onPointerDown);
    document.addEventListener('keydown', onKeydown);
    return () => {
      offDoubleTap();
      document.removeEventListener('pointerdown', onPointerDown);
      document.removeEventListener('keydown', onKeydown);
    };
  }, [editor, engine, history, clipboard, host, closeMenu]);

  const selectAll = (): void => {
    engine!.selection.selectAll();
    closeMenu();
  };

  const deleteTarget = (request: ContextMenuRequest): void => {
    if ((request.target.kind === 'node' || request.target.kind === 'edge') && request.target.id) {
      engine!.selection.set([request.target.id]);
    }
    engine!.key({ key: 'Delete', modifiers: NO_MODIFIERS });
    closeMenu();
  };

  void ready;
  return (
    <>
      <header style={HEADER_STYLE}>
        <strong>GraphLoom React editor</strong>
        <span>
          selected: <span data-testid="selected">{selection.length}</span>
        </span>
        <span>
          nodes: <span data-testid="nodes">{nodes.length}</span>
        </span>
        <span>
          edges: <span data-testid="edges">{edges.length}</span>
        </span>
        <span>
          undo: <span data-testid="can-undo">{canUndo ? 'yes' : 'no'}</span>
        </span>
        <span style={{ color: '#5a6478' }}>
          double-click: add node · drag port: connect · right-click: menu
        </span>
      </header>
      {menu ? (
        <div
          data-testid="menu"
          style={{ ...MENU_STYLE, left: menu.screenPoint.x, top: menu.screenPoint.y }}
        >
          {menu.target.kind === 'canvas' ? (
            <button type="button" style={MENU_BUTTON_STYLE} onClick={selectAll}>
              Select all
            </button>
          ) : (
            <button
              type="button"
              data-testid="menu-delete"
              style={MENU_BUTTON_STYLE}
              onClick={() => deleteTarget(menu)}
            >
              Delete
            </button>
          )}
        </div>
      ) : null}
    </>
  );
};

/** The demo app: <Graph> fills the viewport; all chrome lives inside it. */
export const App = (): ReactNode => {
  const [menu, setMenu] = useState<ContextMenuRequest | null>(null);
  const closeMenu = useCallback(() => setMenu(null), []);
  return (
    <main
      data-testid="graph"
      style={{ position: 'relative', height: '100vh', fontFamily: 'system-ui, sans-serif' }}
    >
      <Graph
        document={DOC}
        nodeTypes={{ card: Card }}
        onContextMenu={setMenu}
        style={{ position: 'absolute', inset: 0 }}
      >
        <Chrome menu={menu} closeMenu={closeMenu} />
      </Graph>
    </main>
  );
};

declare global {
  interface Window {
    reactDemo: {
      editor: NonNullable<GraphParts['editor']>;
      engine: NonNullable<GraphParts['engine']>;
      history: NonNullable<GraphParts['history']>;
      clipboard: NonNullable<GraphParts['clipboard']>;
      host: NonNullable<GraphParts['host']>;
    };
  }
}
