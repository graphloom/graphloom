import type { Unsubscribe } from '@graphloom/core';
import type { InteractionEngine } from './engine.js';
import type { Modifiers, PointerInput, PointerKind } from './gestures.js';

/** Options for {@link attachInteraction}. */
export interface AttachOptions {
  /**
   * Where keyboard listeners go (default: the element's window). Keys are
   * ignored while focus is in a text input/textarea/select/contenteditable
   * anywhere in the host page (tracker P4-T08 rule).
   */
  readonly keyboardTarget?: EventTarget;
  /** Suppress the native context menu on the canvas (default true). */
  readonly suppressContextMenu?: boolean;
}

const modifiersOf = (e: MouseEvent | KeyboardEvent | WheelEvent): Modifiers => ({
  shift: e.shiftKey,
  ctrl: e.ctrlKey,
  alt: e.altKey,
  meta: e.metaKey,
});

const isTextInput = (target: EventTarget | null): boolean => {
  if (!(target instanceof HTMLElement)) return false;
  return (
    target instanceof HTMLInputElement ||
    target instanceof HTMLTextAreaElement ||
    target instanceof HTMLSelectElement ||
    target.isContentEditable
  );
};

/** Wheel deltas normalized to pixels (deltaMode 1 = lines, 2 = pages). */
const wheelPixels = (e: WheelEvent, delta: number): number =>
  delta * (e.deltaMode === 1 ? 16 : e.deltaMode === 2 ? 400 : 1);

/**
 * The DOM adapter (P4-T11): translates real browser events into the engine's
 * normalized samples. This is the only DOM-aware code in the package — the
 * engine and every controller stay headless — and it owns the browser-quirk
 * duties the tracker assigns to the boundary: pointer capture, wheel
 * delta-mode normalization, space-to-pan, the text-input keyboard guard,
 * and native context-menu suppression. Returns a detach function.
 */
export function attachInteraction(
  engine: InteractionEngine,
  element: HTMLElement,
  options: AttachOptions = {},
): Unsubscribe {
  const win = element.ownerDocument.defaultView;
  const keyboard = options.keyboardTarget ?? win;

  const sample = (e: PointerEvent): PointerInput => {
    const box = element.getBoundingClientRect();
    return {
      pointerId: e.pointerId,
      point: { x: e.clientX - box.left, y: e.clientY - box.top },
      button: e.button >= 0 ? e.button : 0,
      pointerType: (e.pointerType || 'mouse') as PointerKind,
      modifiers: modifiersOf(e),
      timestamp: e.timeStamp,
    };
  };

  const onPointerDown = (e: PointerEvent): void => {
    // Capture so drags keep reporting after the pointer leaves the canvas.
    try {
      element.setPointerCapture(e.pointerId);
    } catch {
      // jsdom and detached elements have no capture — gestures still work.
    }
    engine.pointerDown(sample(e));
  };
  const onPointerMove = (e: PointerEvent): void => {
    engine.pointerMove(sample(e));
  };
  const onPointerUp = (e: PointerEvent): void => {
    try {
      element.releasePointerCapture(e.pointerId);
    } catch {
      // not captured — fine
    }
    engine.pointerUp(sample(e));
  };
  const onPointerCancel = (e: PointerEvent): void => {
    engine.pointerCancel(sample(e));
  };

  const onWheel = (e: WheelEvent): void => {
    e.preventDefault(); // the canvas owns scroll/zoom
    const box = element.getBoundingClientRect();
    engine.wheel({
      point: { x: e.clientX - box.left, y: e.clientY - box.top },
      deltaY: wheelPixels(e, e.deltaY),
      deltaX: wheelPixels(e, e.deltaX),
      modifiers: modifiersOf(e),
    });
  };

  const onKeyDown = (e: Event): void => {
    const k = e as KeyboardEvent;
    if (isTextInput(k.target)) return;
    if (k.key === ' ') {
      engine.panMode = true;
      k.preventDefault(); // don't scroll the page
      return;
    }
    if (engine.key({ key: k.key, modifiers: modifiersOf(k) })) k.preventDefault();
  };
  const onKeyUp = (e: Event): void => {
    if ((e as KeyboardEvent).key === ' ') engine.panMode = false;
  };

  const onContextMenu = (e: Event): void => {
    e.preventDefault(); // the engine emits contextmenu.requested instead
  };

  element.addEventListener('pointerdown', onPointerDown);
  element.addEventListener('pointermove', onPointerMove);
  element.addEventListener('pointerup', onPointerUp);
  element.addEventListener('pointercancel', onPointerCancel);
  element.addEventListener('wheel', onWheel, { passive: false });
  keyboard?.addEventListener('keydown', onKeyDown);
  keyboard?.addEventListener('keyup', onKeyUp);
  const suppress = options.suppressContextMenu ?? true;
  if (suppress) element.addEventListener('contextmenu', onContextMenu);

  return () => {
    element.removeEventListener('pointerdown', onPointerDown);
    element.removeEventListener('pointermove', onPointerMove);
    element.removeEventListener('pointerup', onPointerUp);
    element.removeEventListener('pointercancel', onPointerCancel);
    element.removeEventListener('wheel', onWheel);
    keyboard?.removeEventListener('keydown', onKeyDown);
    keyboard?.removeEventListener('keyup', onKeyUp);
    if (suppress) element.removeEventListener('contextmenu', onContextMenu);
  };
}
