import type { GraphEditor, JsonObject, Point } from '@graphloom/core';
import type { SpatialIndex } from '@graphloom/rendering';
import type { Selection } from './selection.js';

/** What was right-clicked/long-pressed. */
export type ContextMenuTargetKind = 'node' | 'edge' | 'canvas' | 'selection';

/** The typed target of a context menu request. */
export interface ContextMenuTarget {
  readonly kind: ContextMenuTargetKind;
  /** Element id for node/edge targets. */
  readonly id?: string;
  /** Selected ids for selection targets. */
  readonly selected?: readonly string[];
}

/** One menu entry: the registered key plus the plugin's opaque descriptor. */
export interface ContextMenuEntry {
  readonly key: string;
  readonly item: JsonObject;
}

/**
 * A context menu request (P4-T10): pure data. Core supplies target +
 * contributed items; hosts and framework wrappers render the actual menu UI,
 * keeping the core DOM-free beyond the canvas (ADR-0002 spirit).
 */
export interface ContextMenuRequest {
  /** World coordinates of the invocation point. */
  readonly worldPoint: Point;
  /** Screen coordinates (for menu placement). */
  readonly screenPoint: Point;
  readonly target: ContextMenuTarget;
  /** `menu`-kind contributions from installed plugins, in registration order. */
  readonly items: readonly ContextMenuEntry[];
}

/**
 * Builds a {@link ContextMenuRequest} for a right-click/long-press at
 * `worldPoint`. Target resolution: hit element inside the current
 * multi-selection → `selection`; hit node/edge → that element; else `canvas`.
 * Items reflect the live contribution registry, so plugin install/uninstall
 * appears/disappears automatically.
 */
export function buildContextMenuRequest(
  editor: GraphEditor,
  selection: Selection,
  spatial: SpatialIndex,
  worldPoint: Point,
  screenPoint: Point,
  tolerance = 0,
): ContextMenuRequest {
  const hit = spatial.hitTest(worldPoint, {
    tolerance,
    filter: (item) => item.element === 'node' || item.element === 'edge',
  });
  let target: ContextMenuTarget;
  if (!hit) {
    target = { kind: 'canvas' };
  } else if (selection.size > 1 && selection.has(hit.elementId)) {
    target = { kind: 'selection', selected: selection.ids() };
  } else {
    target = { kind: hit.element as 'node' | 'edge', id: hit.elementId };
  }
  const items: ContextMenuEntry[] = [];
  for (const [key, contribution] of editor.registries.contributions) {
    if (contribution.kind === 'menu') items.push({ key, item: contribution.item });
  }
  return { worldPoint, screenPoint, target, items };
}
