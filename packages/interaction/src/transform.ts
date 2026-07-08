import {
  commands,
  Emitter,
  type GraphEditor,
  type Node,
  type Point,
  type Size,
  type Unsubscribe,
} from '@graphloom/core';
import {
  applyToPoint,
  clamp,
  rotationAbout,
  type ViewportController,
} from '@graphloom/rendering';
import type { Modifiers } from './gestures.js';

/** Selection-chrome handle ids: 8 resize handles plus the rotate handle. */
export type HandleId = 'nw' | 'n' | 'ne' | 'e' | 'se' | 's' | 'sw' | 'w' | 'rotate';

/** The transformable slice of a node. */
export interface NodeTransform {
  readonly position: Point;
  readonly size: Size;
  readonly rotation: number;
}

/** Options for {@link TransformController} and {@link resizeNode}. */
export interface TransformOptions {
  /** Smallest node width/height (world units). Default 10. */
  readonly minSize?: number;
  /** Largest node width/height. Default Infinity. */
  readonly maxSize?: number;
  /** Rotate-handle distance above the node's top edge (world units at zoom 1). */
  readonly rotateHandleOffset?: number;
}

/** Rotation snap step used while shift is held (tracker: 15°). */
export const ROTATION_SNAP_DEGREES = 15;

/** Normalized rect coordinates (0..1) each resize handle controls. */
const HANDLE_FACTORS: Record<Exclude<HandleId, 'rotate'>, { fx: number; fy: number }> = {
  nw: { fx: 0, fy: 0 },
  n: { fx: 0.5, fy: 0 },
  ne: { fx: 1, fy: 0 },
  e: { fx: 1, fy: 0.5 },
  se: { fx: 1, fy: 1 },
  s: { fx: 0.5, fy: 1 },
  sw: { fx: 0, fy: 1 },
  w: { fx: 0, fy: 0.5 },
};

const center = (t: NodeTransform): Point => ({
  x: t.position.x + t.size.width / 2,
  y: t.position.y + t.size.height / 2,
});

/**
 * World positions of the selection-chrome handles for `node` (rotation
 * applied). The engine hit-tests these with a screen-space radius; renderers
 * draw them from the same data so picking always matches pixels.
 */
export function handlePositions(
  node: NodeTransform,
  rotateHandleOffset = 24,
): Record<HandleId, Point> {
  const { x, y } = node.position;
  const { width, height } = node.size;
  const m = rotationAbout(node.rotation, x + width / 2, y + height / 2);
  const at = (fx: number, fy: number): Point =>
    applyToPoint(m, { x: x + fx * width, y: y + fy * height });
  const out = {} as Record<HandleId, Point>;
  for (const [id, { fx, fy }] of Object.entries(HANDLE_FACTORS)) {
    out[id as HandleId] = at(fx, fy);
  }
  out.rotate = applyToPoint(m, { x: x + width / 2, y: y - rotateHandleOffset });
  return out;
}

/**
 * Resize math (P4-T05), correct for rotated nodes (the classic bug): the
 * pointer is mapped into the node's unrotated local frame, the rect is
 * rebuilt there with the opposite handle (or the center with `centered`)
 * anchored, and the new center is mapped back through the **old** center's
 * rotation — so the anchor point never moves on screen.
 */
export function resizeNode(
  start: NodeTransform,
  handle: Exclude<HandleId, 'rotate'>,
  pointerWorld: Point,
  flags: { aspect?: boolean; centered?: boolean } = {},
  options: TransformOptions = {},
): NodeTransform {
  const minSize = options.minSize ?? 10;
  const maxSize = options.maxSize ?? Infinity;
  const { fx, fy } = HANDLE_FACTORS[handle];
  const c0 = center(start);
  const local = applyToPoint(rotationAbout(-start.rotation, c0.x, c0.y), pointerWorld);
  const { x, y } = start.position;
  const { width: w0, height: h0 } = start.size;

  // Anchor in local space: the opposite point, or the center when `centered`.
  const ax = flags.centered ? 0.5 : 1 - fx;
  const ay = flags.centered ? 0.5 : 1 - fy;
  const anchor = { x: x + ax * w0, y: y + ay * h0 };

  // New extents along the axes this handle controls (never mirror-flips —
  // shrinking past the anchor clamps at minSize).
  const scale = flags.centered ? 2 : 1;
  let width = fx === 0.5 ? w0 : Math.abs(local.x - anchor.x) * scale;
  let height = fy === 0.5 ? h0 : Math.abs(local.y - anchor.y) * scale;

  if (flags.aspect) {
    const s =
      fx !== 0.5 && fy !== 0.5
        ? Math.max(width / w0, height / h0)
        : fx !== 0.5
          ? width / w0
          : height / h0;
    width = w0 * s;
    height = h0 * s;
  }
  width = clamp(width, minSize, maxSize);
  height = clamp(height, minSize, maxSize);

  // Rebuild the local rect so the anchor keeps its normalized position, then
  // carry the new center back through the old rotation pivot.
  const nx = anchor.x - ax * width;
  const ny = anchor.y - ay * height;
  const localCenter = { x: nx + width / 2, y: ny + height / 2 };
  const worldCenter = applyToPoint(rotationAbout(start.rotation, c0.x, c0.y), localCenter);
  return {
    position: { x: worldCenter.x - width / 2, y: worldCenter.y - height / 2 },
    size: { width, height },
    rotation: start.rotation,
  };
}

/** Rotation from dragging the rotate handle; `snap` rounds to 15° steps. */
export function rotateNode(
  start: NodeTransform,
  grabWorld: Point,
  pointerWorld: Point,
  snap: boolean,
): NodeTransform {
  const c = center(start);
  const angle =
    ((Math.atan2(pointerWorld.y - c.y, pointerWorld.x - c.x) -
      Math.atan2(grabWorld.y - c.y, grabWorld.x - c.x)) *
      180) /
    Math.PI;
  let rotation = start.rotation + angle;
  if (snap) rotation = Math.round(rotation / ROTATION_SNAP_DEGREES) * ROTATION_SNAP_DEGREES;
  rotation = ((rotation % 360) + 360) % 360;
  return { ...start, rotation };
}

/** Events emitted by {@link TransformController}. */
export interface TransformEventMap {
  /** Ephemeral preview transform (`null` when the gesture ends/cancels). */
  'transform.preview': { readonly id: string; readonly transform: NodeTransform | null };
}

/**
 * Resize/rotate gesture controller (P4-T05). Same contract as dragging:
 * ephemeral preview, one `node.update` transaction on release, cancel leaves
 * the model untouched. Locked nodes are rejected at `begin`. Multi-select
 * bounds resize is deferred to the backlog (tracker).
 */
export class TransformController {
  #editor: GraphEditor;
  #viewport: ViewportController;
  #options: TransformOptions;
  #emitter = new Emitter<TransformEventMap>();
  #state: {
    id: string;
    handle: HandleId;
    start: NodeTransform;
    grabWorld: Point;
    preview: NodeTransform | null;
  } | null = null;

  constructor(
    editor: GraphEditor,
    viewport: ViewportController,
    options: TransformOptions = {},
  ) {
    this.#editor = editor;
    this.#viewport = viewport;
    this.#options = options;
  }

  /** True while a resize/rotate is in flight. */
  get active(): boolean {
    return this.#state !== null;
  }

  /** Subscribes to transform events; returns an unsubscriber. */
  on<K extends keyof TransformEventMap>(
    type: K,
    handler: (payload: TransformEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** Starts transforming `node` by `handle` from screen point `origin`. */
  begin(node: Node, handle: HandleId, origin: Point): boolean {
    if (node.locked) return false;
    this.#state = {
      id: node.id,
      handle,
      start: { position: node.position, size: node.size, rotation: node.rotation },
      grabWorld: this.#viewport.screenToWorld(origin),
      preview: null,
    };
    return true;
  }

  /** Updates the preview (shift = aspect-lock / 15° rotation snap, alt = center-resize). */
  move(point: Point, modifiers?: Modifiers): void {
    const s = this.#state;
    if (!s) return;
    const world = this.#viewport.screenToWorld(point);
    s.preview =
      s.handle === 'rotate'
        ? rotateNode(s.start, s.grabWorld, world, modifiers?.shift ?? false)
        : resizeNode(
            s.start,
            s.handle,
            world,
            { aspect: modifiers?.shift ?? false, centered: modifiers?.alt ?? false },
            this.#options,
          );
    this.#emitter.emit('transform.preview', { id: s.id, transform: s.preview });
  }

  /** Commits the preview as one history entry. */
  end(): void {
    const s = this.#state;
    this.#clear();
    if (!s?.preview) return;
    const { position, size, rotation } = s.preview;
    this.#editor.transact(() => {
      this.#editor.execute(commands.nodeUpdate(s.id, { position, size, rotation }));
    });
  }

  /** Aborts (ESC / pointercancel): model untouched. */
  cancel(): void {
    this.#clear();
  }

  #clear(): void {
    const s = this.#state;
    this.#state = null;
    if (s?.preview) this.#emitter.emit('transform.preview', { id: s.id, transform: null });
  }
}
