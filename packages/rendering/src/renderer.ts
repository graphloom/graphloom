import type { Point, Size } from '@graphloom/core';
import type { SceneFrame } from './frame.js';
import type { RenderItemId } from './scene.js';
import { pickTopmost } from './spatial.js';
import { createTextMeasurer, type TextStyle } from './text.js';

/**
 * The one contract every rendering backend implements (ADR-0002). Renderers
 * are stateless with respect to the model: their only input is
 * {@link SceneFrame}s, so destroy + recreate mid-session is lossless.
 */
export interface Renderer {
  /** Attaches the renderer's output to a host element (client-side only). */
  mount(host: HTMLElement): void;
  /** Draws a frame, patching only the frame's dirty items where possible. */
  render(frame: SceneFrame): void;
  /**
   * The top-most item at a point in **screen coordinates** (CSS px relative
   * to the host). Answers from the last rendered frame via the shared pick
   * routine — never from DOM event targets (ADR-0002).
   */
  hitTest(point: Point): RenderItemId | null;
  /** Measures a single line of text (server-safe estimating fallback). */
  measureText(text: string, style: TextStyle): Size;
  /** Detaches from the host and releases resources. Safe to call twice. */
  destroy(): void;
}

/**
 * Screen→world conversion for a frame, then the shared pick. Backends build
 * their `hitTest` on this so results are identical across renderers.
 */
export function hitTestFrame(frame: SceneFrame | null, point: Point): RenderItemId | null {
  if (!frame) return null;
  const { x, y, zoom } = frame.viewport;
  const world = { x: (point.x - x) / zoom, y: (point.y - y) / zoom };
  return pickTopmost(frame.items, world)[0]?.id ?? null;
}

/**
 * A no-DOM reference renderer: remembers the last frame and answers hit tests
 * and measurements exactly like a real backend. Drives the conformance suite
 * and works as a headless stand-in in tests.
 */
export function createMockRenderer(): Renderer & { readonly lastFrame: SceneFrame | null } {
  let lastFrame: SceneFrame | null = null;
  let mounted: HTMLElement | null = null;
  const measure = createTextMeasurer();
  return {
    get lastFrame() {
      return lastFrame;
    },
    mount(host) {
      mounted = host;
    },
    render(frame) {
      if (!mounted) throw new Error('render() before mount()');
      lastFrame = frame;
    },
    hitTest(point) {
      return hitTestFrame(lastFrame, point);
    },
    measureText(text, style) {
      return measure(text, style);
    },
    destroy() {
      mounted = null;
      lastFrame = null;
    },
  };
}
