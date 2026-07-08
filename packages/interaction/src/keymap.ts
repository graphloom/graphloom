import { commands, type GraphEditor, type Point } from '@graphloom/core';
import {
  rotatedRectBounds,
  unionRects,
  type Rect,
  type ViewportController,
} from '@graphloom/rendering';
import type { KeyInput } from './gestures.js';
import type { Selection } from './selection.js';

/**
 * A keymap is plain data: normalized chord → action name. Hosts rebind by
 * supplying their own map (P4-T08: keymap is data). Chord syntax:
 * `Shift+Alt+Mod+Key` in that order; `Mod` matches ctrl **or** meta, giving
 * mac/win parity from one table. The DOM adapter must not forward keys while
 * a host text input has focus — that policy lives at the boundary, not here.
 */
export type Keymap = Readonly<Record<string, string>>;

/** Built-in bindings (tracker P4-T08 set). */
export const DEFAULT_KEYMAP: Keymap = {
  Delete: 'delete',
  Backspace: 'delete',
  'Mod+Z': 'undo',
  'Shift+Mod+Z': 'redo',
  'Mod+Y': 'redo',
  'Mod+A': 'select-all',
  Escape: 'escape',
  ArrowLeft: 'nudge-left',
  ArrowRight: 'nudge-right',
  ArrowUp: 'nudge-up',
  ArrowDown: 'nudge-down',
  'Shift+ArrowLeft': 'nudge-left-big',
  'Shift+ArrowRight': 'nudge-right-big',
  'Shift+ArrowUp': 'nudge-up-big',
  'Shift+ArrowDown': 'nudge-down-big',
  '+': 'zoom-in',
  '=': 'zoom-in',
  '-': 'zoom-out',
  '0': 'zoom-fit',
};

/** Normalizes a key input to chord form (`Shift+Alt+Mod+Key`). */
export function chordOf(input: KeyInput): string {
  const m = input.modifiers;
  const key = input.key.length === 1 ? input.key.toUpperCase() : input.key;
  return [
    m?.shift ? 'Shift' : '',
    m?.alt ? 'Alt' : '',
    m?.ctrl || m?.meta ? 'Mod' : '',
    key,
  ]
    .filter(Boolean)
    .join('+');
}

/** Resolves a key input against a keymap; `null` when unbound. */
export function actionFor(input: KeyInput, keymap: Keymap = DEFAULT_KEYMAP): string | null {
  return keymap[chordOf(input)] ?? null;
}

/** What the shortcut dispatcher needs from the host wiring. */
export interface ShortcutDeps {
  readonly editor: GraphEditor;
  readonly selection: Selection;
  readonly viewport: ViewportController;
  /** Undo/redo service (P2-T06); undo/redo actions are no-ops without it. */
  readonly history?: { undo(): boolean; redo(): boolean };
  /**
   * Cancels any in-flight gesture; return true if something was cancelled.
   * Escape falls through to clearing the selection otherwise.
   */
  readonly cancel?: () => boolean;
}

const NUDGE: Record<string, Point> = {
  'nudge-left': { x: -1, y: 0 },
  'nudge-right': { x: 1, y: 0 },
  'nudge-up': { x: 0, y: -1 },
  'nudge-down': { x: 0, y: 1 },
};

/** Small/big nudge steps in world units (big = shift). */
export const NUDGE_STEP = 1;
export const NUDGE_STEP_BIG = 10;

/** Union world bounds of all visible nodes (rotation included); null when empty. */
export function contentBounds(editor: GraphEditor): Rect | null {
  let bounds: Rect | null = null;
  for (const node of editor.graph.nodes()) {
    if (node.hidden) continue;
    const r = rotatedRectBounds(
      {
        x: node.position.x,
        y: node.position.y,
        width: node.size.width,
        height: node.size.height,
      },
      node.rotation,
    );
    bounds = bounds ? unionRects(bounds, r) : r;
  }
  return bounds;
}

/**
 * Executes keyboard actions (P4-T08). Returns true when the input was
 * handled (hosts `preventDefault` on true). Every model-touching action is
 * one transaction = one history entry (a multi-selection nudge undoes as one).
 */
export function createShortcutHandler(
  deps: ShortcutDeps,
  keymap: Keymap = DEFAULT_KEYMAP,
): (input: KeyInput) => boolean {
  const { editor, selection, viewport, history, cancel } = deps;

  const nudge = (direction: Point, step: number): void => {
    const nodes = selection
      .nodeIds()
      .map((id) => editor.graph.getNode(id))
      .filter((n): n is NonNullable<typeof n> => n !== undefined && !n.locked);
    if (nodes.length === 0) return;
    editor.transact(() => {
      for (const node of nodes) {
        editor.execute(
          commands.nodeUpdate(node.id, {
            position: {
              x: node.position.x + direction.x * step,
              y: node.position.y + direction.y * step,
            },
          }),
        );
      }
    });
  };

  const remove = (): void => {
    const ids = selection.ids();
    if (ids.length === 0) return;
    editor.transact(() => {
      // Edges first, then nodes (node.remove cascades edges; removing an
      // already-cascaded edge would throw).
      for (const id of ids) {
        if (editor.graph.getEdge(id)) editor.execute(commands.edgeRemove(id));
      }
      for (const id of ids) {
        if (editor.graph.getNode(id)) editor.execute(commands.nodeRemove(id));
      }
    });
  };

  return (input) => {
    const action = actionFor(input, keymap);
    if (action === null) return false;
    const base = action.replace(/-big$/, '');
    if (NUDGE[base]) {
      nudge(NUDGE[base], action.endsWith('-big') ? NUDGE_STEP_BIG : NUDGE_STEP);
      return true;
    }
    switch (action) {
      case 'delete':
        remove();
        return true;
      case 'undo':
        history?.undo();
        return true;
      case 'redo':
        history?.redo();
        return true;
      case 'select-all':
        selection.selectAll();
        return true;
      case 'escape':
        if (!cancel?.()) selection.clear();
        return true;
      case 'zoom-in':
        viewport.zoomBy(2 ** 0.5);
        return true;
      case 'zoom-out':
        viewport.zoomBy(2 ** -0.5);
        return true;
      case 'zoom-fit':
        viewport.zoomToFit(contentBounds(editor));
        return true;
      default:
        return false; // unknown action name in a host keymap
    }
  };
}
