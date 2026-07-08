import type { ViewportController } from '@graphloom/rendering';
import type { PinchGesture, WheelInput } from './gestures.js';

/** Options for {@link PanZoomController}. */
export interface PanZoomOptions {
  /**
   * Wheel sensitivity: zoom factor is `2^(-deltaY · sensitivity)`. Trackpad
   * pinches (ctrl+wheel) get 10× — they report tiny deltas. Default 0.002.
   */
  readonly wheelSensitivity?: number;
}

/**
 * Pan/zoom gesture semantics over the P3 viewport math (P4-T02, ADR-0006:
 * our own wheel/pinch math, no `d3-zoom`). Zoom limits and anchoring live in
 * {@link ViewportController}; this layer only turns inputs into pan/zoom calls.
 *
 * Drag-to-pan routing (space+drag, middle button, two-finger) is decided by
 * the interaction engine; it calls {@link PanZoomController.panBy}.
 */
// ponytail: no zoom momentum/inertia (tracker says optional-off) and no
// animated fit — instant fit trivially satisfies reduced-motion; add an
// animation clock only when a renderer wants eased transitions.
export class PanZoomController {
  #viewport: ViewportController;
  #sensitivity: number;

  constructor(viewport: ViewportController, options: PanZoomOptions = {}) {
    this.#viewport = viewport;
    this.#sensitivity = options.wheelSensitivity ?? 0.002;
  }

  /** Wheel zoom about the cursor; ctrl+wheel is a trackpad pinch (finer deltas, 10×). */
  wheel(input: WheelInput): void {
    const boost = input.modifiers?.ctrl ? 10 : 1;
    this.#viewport.zoomBy(2 ** (-input.deltaY * this.#sensitivity * boost), input.point);
  }

  /** Touch pinch: scale about the moving centroid, then follow it (two-finger pan). */
  pinch(gesture: PinchGesture): void {
    if (gesture.scale !== 1) this.#viewport.zoomBy(gesture.scale, gesture.center);
    if (gesture.delta.x !== 0 || gesture.delta.y !== 0) {
      this.#viewport.panBy(gesture.delta.x, gesture.delta.y);
    }
  }

  /** Pans by a screen-space delta (drag-to-pan). */
  panBy(dx: number, dy: number): void {
    this.#viewport.panBy(dx, dy);
  }
}
