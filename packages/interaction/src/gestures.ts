import { Emitter, type Point, type Unsubscribe } from '@graphloom/core';

/** Keyboard modifier state carried on every input (normalized mac/win by the adapter). */
export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

/** All modifiers up. */
export const NO_MODIFIERS: Modifiers = { shift: false, ctrl: false, alt: false, meta: false };

/** Input device class (mirrors `PointerEvent.pointerType`). */
export type PointerKind = 'mouse' | 'touch' | 'pen';

/**
 * A normalized pointer sample (P4-T01). The interaction engine is headless:
 * hosts translate DOM `PointerEvent`s (or synthetic test sequences) into
 * these. Points are screen CSS pixels relative to the canvas origin.
 */
export interface PointerInput {
  readonly pointerId: number;
  readonly point: Point;
  /** Pressed button on `down` (0 left, 1 middle, 2 right). Default 0. */
  readonly button?: number;
  readonly pointerType?: PointerKind;
  readonly modifiers?: Modifiers;
  /** Milliseconds on any monotonic clock (e.g. `event.timeStamp`). */
  readonly timestamp: number;
}

/** A normalized wheel sample (deltas in pixels, `deltaMode` pre-normalized by the adapter). */
export interface WheelInput {
  readonly point: Point;
  readonly deltaY: number;
  readonly deltaX?: number;
  readonly modifiers?: Modifiers;
}

/** A normalized key-down sample (see {@link Keymap} for chord syntax). */
export interface KeyInput {
  /** `KeyboardEvent.key` (case-insensitive for letters). */
  readonly key: string;
  readonly modifiers?: Modifiers;
}

/** Payload shared by pointer-derived gesture events. */
export interface GesturePoint {
  readonly point: Point;
  readonly button: number;
  readonly pointerType: PointerKind;
  readonly modifiers: Modifiers;
}

/** Drag gesture payload; `origin` is the pointer-down point. */
export interface DragGesture extends GesturePoint {
  readonly origin: Point;
  /** Delta since the previous move (screen px). */
  readonly delta: Point;
}

/** Pinch gesture payload (two pointers). */
export interface PinchGesture {
  /** Current centroid of the two pointers (screen px). */
  readonly center: Point;
  /** Centroid movement since the previous update (screen px). */
  readonly delta: Point;
  /** Scale relative to the previous update (multiply zoom by this). */
  readonly scale: number;
}

/** Events emitted by {@link GestureRecognizer}. */
export interface GestureEventMap {
  /** Pointer down+up within the slop threshold. */
  tap: GesturePoint;
  /** Second tap within `doubleTapMs` and slop of the previous tap. */
  'double-tap': GesturePoint;
  /** Pointer held within slop for `longPressMs` (touch context menu). */
  'long-press': GesturePoint;
  /** Pointer moved beyond slop with one pointer down. */
  'drag-start': DragGesture;
  'drag-move': DragGesture;
  'drag-end': DragGesture;
  /** `pointercancel` (or a second finger) aborted the drag — consumers must discard previews. */
  'drag-cancel': DragGesture;
  'pinch-start': PinchGesture;
  'pinch-move': PinchGesture;
  'pinch-end': PinchGesture;
}

/** Options for {@link GestureRecognizer}. */
export interface GestureOptions {
  /** Movement (px) before a press becomes a drag. Default 4. */
  readonly slop?: number;
  /** Max gap between taps for a double-tap. Default 400 ms. */
  readonly doubleTapMs?: number;
  /** Hold duration for long-press. Default 500 ms. */
  readonly longPressMs?: number;
  /** Timer injection for tests; defaults to `setTimeout`/`clearTimeout`. */
  readonly schedule?: (fn: () => void, ms: number) => () => void;
}

interface TrackedPointer {
  origin: Point;
  last: Point;
  button: number;
  pointerType: PointerKind;
  modifiers: Modifiers;
  dragging: boolean;
  /** Long-press already fired — the up must not produce a tap. */
  consumed: boolean;
  cancelLongPress: (() => void) | undefined;
}

const dist = (a: Point, b: Point): number => Math.hypot(a.x - b.x, a.y - b.y);
const mid = (a: Point, b: Point): Point => ({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 });

const defaultSchedule = (fn: () => void, ms: number): (() => void) => {
  const handle = setTimeout(fn, ms);
  return () => clearTimeout(handle);
};

/**
 * Unified gesture layer over normalized pointer samples (P4-T01, risk R8):
 * click/drag disambiguation via slop, double-tap, long-press, two-pointer
 * pinch, mouse/touch/pen parity. Feed it `down`/`move`/`up`/`cancel`; it
 * emits {@link GestureEventMap} events. Pointer capture and browser quirks
 * live in the DOM adapter, never here.
 */
export class GestureRecognizer {
  #emitter = new Emitter<GestureEventMap>();
  #pointers = new Map<number, TrackedPointer>();
  #slop: number;
  #doubleTapMs: number;
  #longPressMs: number;
  #schedule: (fn: () => void, ms: number) => () => void;
  #lastTap: { point: Point; timestamp: number } | null = null;
  /** Pinch baseline: distance/centroid at the previous pinch update. */
  #pinch: { distance: number; center: Point } | null = null;

  constructor(options: GestureOptions = {}) {
    this.#slop = options.slop ?? 4;
    this.#doubleTapMs = options.doubleTapMs ?? 400;
    this.#longPressMs = options.longPressMs ?? 500;
    this.#schedule = options.schedule ?? defaultSchedule;
  }

  /** Subscribes to a gesture event; returns an unsubscriber. */
  on<K extends keyof GestureEventMap>(
    type: K,
    handler: (payload: GestureEventMap[K]) => void,
  ): Unsubscribe {
    return this.#emitter.on(type, handler);
  }

  /** True while a drag gesture is active. */
  get dragging(): boolean {
    return [...this.#pointers.values()].some((p) => p.dragging);
  }

  /** Feeds a pointer-down sample. */
  down(input: PointerInput): void {
    const tracked: TrackedPointer = {
      origin: input.point,
      last: input.point,
      button: input.button ?? 0,
      pointerType: input.pointerType ?? 'mouse',
      modifiers: input.modifiers ?? NO_MODIFIERS,
      dragging: false,
      consumed: false,
      cancelLongPress: undefined,
    };
    this.#pointers.set(input.pointerId, tracked);

    if (this.#pointers.size === 2) {
      this.#startPinch();
      return;
    }
    if (this.#pointers.size === 1) {
      tracked.cancelLongPress = this.#schedule(() => {
        // Still a stationary single press? Fire long-press and eat the tap.
        if (this.#pointers.get(input.pointerId) === tracked && !tracked.dragging && !this.#pinch) {
          tracked.consumed = true;
          this.#emitter.emit('long-press', this.#gesturePoint(tracked, tracked.last));
        }
      }, this.#longPressMs);
    }
  }

  /** Feeds a pointer-move sample. */
  move(input: PointerInput): void {
    const tracked = this.#pointers.get(input.pointerId);
    if (!tracked) return;
    const previous = tracked.last;
    tracked.last = input.point;
    if (input.modifiers) tracked.modifiers = input.modifiers;

    if (this.#pinch) {
      const [a, b] = [...this.#pointers.values()];
      if (!a || !b) return;
      const center = mid(a.last, b.last);
      const distance = Math.max(1, dist(a.last, b.last));
      this.#emitter.emit('pinch-move', {
        center,
        delta: { x: center.x - this.#pinch.center.x, y: center.y - this.#pinch.center.y },
        scale: distance / this.#pinch.distance,
      });
      this.#pinch = { distance, center };
      return;
    }

    if (!tracked.dragging && dist(input.point, tracked.origin) > this.#slop) {
      tracked.dragging = true;
      tracked.consumed = true;
      tracked.cancelLongPress?.();
      this.#emitter.emit('drag-start', this.#drag(tracked, tracked.origin, { x: 0, y: 0 }));
    }
    if (tracked.dragging) {
      this.#emitter.emit(
        'drag-move',
        this.#drag(tracked, input.point, {
          x: input.point.x - previous.x,
          y: input.point.y - previous.y,
        }),
      );
    }
  }

  /** Feeds a pointer-up sample. */
  up(input: PointerInput): void {
    const tracked = this.#pointers.get(input.pointerId);
    if (!tracked) return;
    tracked.cancelLongPress?.();
    this.#pointers.delete(input.pointerId);

    if (this.#pinch) {
      this.#endPinch();
      return;
    }
    if (tracked.dragging) {
      this.#emitter.emit('drag-end', this.#drag(tracked, input.point, { x: 0, y: 0 }));
      return;
    }
    if (tracked.consumed) return;

    const gp = this.#gesturePoint(tracked, input.point);
    this.#emitter.emit('tap', gp);
    if (
      this.#lastTap &&
      input.timestamp - this.#lastTap.timestamp <= this.#doubleTapMs &&
      dist(input.point, this.#lastTap.point) <= 2 * this.#slop
    ) {
      this.#emitter.emit('double-tap', gp);
      this.#lastTap = null;
    } else {
      this.#lastTap = { point: input.point, timestamp: input.timestamp };
    }
  }

  /** Feeds a pointercancel — aborts any active drag/pinch with no commit. */
  cancel(input: PointerInput): void {
    const tracked = this.#pointers.get(input.pointerId);
    if (!tracked) return;
    tracked.cancelLongPress?.();
    this.#pointers.delete(input.pointerId);
    if (this.#pinch) {
      this.#endPinch();
      return;
    }
    if (tracked.dragging) {
      this.#emitter.emit('drag-cancel', this.#drag(tracked, tracked.last, { x: 0, y: 0 }));
    }
  }

  #startPinch(): void {
    // A second finger mid-drag aborts the drag (tracker edge case) and hands
    // the gesture to pinch.
    for (const p of this.#pointers.values()) {
      p.cancelLongPress?.();
      p.consumed = true;
      if (p.dragging) {
        p.dragging = false;
        this.#emitter.emit('drag-cancel', this.#drag(p, p.last, { x: 0, y: 0 }));
      }
    }
    const [a, b] = [...this.#pointers.values()];
    if (!a || !b) return;
    this.#pinch = { distance: Math.max(1, dist(a.last, b.last)), center: mid(a.last, b.last) };
    this.#emitter.emit('pinch-start', { center: this.#pinch.center, delta: { x: 0, y: 0 }, scale: 1 });
  }

  #endPinch(): void {
    if (!this.#pinch) return;
    this.#emitter.emit('pinch-end', { center: this.#pinch.center, delta: { x: 0, y: 0 }, scale: 1 });
    this.#pinch = null;
    // The finger left behind must not resume as a drag or become a tap.
    for (const p of this.#pointers.values()) p.consumed = true;
  }

  #gesturePoint(tracked: TrackedPointer, point: Point): GesturePoint {
    return {
      point,
      button: tracked.button,
      pointerType: tracked.pointerType,
      modifiers: tracked.modifiers,
    };
  }

  #drag(tracked: TrackedPointer, point: Point, delta: Point): DragGesture {
    return { ...this.#gesturePoint(tracked, point), origin: tracked.origin, delta };
  }
}
