import type { GraphEditor, Unsubscribe } from '@graphloom/core';
import { FrameBuilder, type FrameOptions, type SceneFrame } from './frame.js';
import type { Renderer } from './renderer.js';
import { SceneGraph, type SceneOptions } from './scene.js';
import { SpatialIndex } from './spatial.js';
import { ViewportController, type ViewportOptions } from './viewport.js';

/** Options for {@link mountRenderer}. */
export interface MountOptions {
  readonly scene?: SceneOptions;
  readonly viewport?: ViewportOptions;
  readonly frame?: FrameOptions;
}

/**
 * A mounted rendering pipeline: editor → scene → index → frames → renderer.
 * Owns host lifecycle (resize observation, DPR changes, rAF batching) and
 * supports swapping the renderer in place (ADR-0002 losslessness).
 */
export interface RenderHost {
  readonly scene: SceneGraph;
  readonly index: SpatialIndex;
  readonly viewport: ViewportController;
  /** The active renderer. */
  readonly renderer: Renderer;
  /** Swaps the backend in place: destroys the old, mounts the new, repaints. */
  setRenderer(next: Renderer): void;
  /** Schedules a render on the next animation frame (coalesces callers). */
  refresh(): void;
  /** Renders synchronously now (tests, screenshots). Returns the frame. */
  renderNow(): SceneFrame;
  /** Tears the whole pipeline down (subscriptions, observers, renderer). */
  destroy(): void;
}

/**
 * Mounts a renderer for an editor on a host element and keeps it painted:
 * model commits and viewport changes schedule a batched requestAnimationFrame
 * render; host resizes update the viewport; DPR changes repaint crisply.
 */
export function mountRenderer(
  editor: GraphEditor,
  renderer: Renderer,
  host: HTMLElement,
  options: MountOptions = {},
): RenderHost {
  const scene = new SceneGraph(editor, options.scene);
  const index = new SpatialIndex(scene);
  const viewport = new ViewportController({
    size: { width: host.clientWidth, height: host.clientHeight },
    ...options.viewport,
  });
  const builder = new FrameBuilder(index, viewport, options.frame);
  const subscriptions: Unsubscribe[] = [];
  let active = renderer;
  let rafHandle: number | null = null;
  let destroyed = false;

  const renderNow = (): SceneFrame => {
    if (rafHandle !== null) {
      cancelAnimationFrame(rafHandle);
      rafHandle = null;
    }
    const frame = builder.frame(typeof devicePixelRatio === 'number' ? devicePixelRatio : 1);
    active.render(frame);
    return frame;
  };

  const refresh = (): void => {
    if (destroyed || rafHandle !== null) return;
    // ponytail: rAF batching lives here once, pipeline-wide, so renderers
    // stay synchronous and trivially testable (tracker T07 batching note).
    if (typeof requestAnimationFrame === 'function') {
      rafHandle = requestAnimationFrame(() => {
        rafHandle = null;
        renderNow();
      });
    } else {
      renderNow();
    }
  };

  active.mount(host);
  subscriptions.push(editor.on('graph.change', refresh));
  subscriptions.push(viewport.on('viewport.changed', refresh));

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver !== 'undefined') {
    resizeObserver = new ResizeObserver(() => {
      viewport.setSize({ width: host.clientWidth, height: host.clientHeight });
      refresh();
    });
    resizeObserver.observe(host);
  }

  // DPR changes (browser zoom, monitor moves) don't fire resize/model events;
  // a matchMedia query on the current resolution re-arms itself on change.
  let dprCleanup: (() => void) | null = null;
  const watchDpr = (): void => {
    if (typeof matchMedia !== 'function' || typeof devicePixelRatio !== 'number') return;
    const query = matchMedia(`(resolution: ${devicePixelRatio}dppx)`);
    const onChange = (): void => {
      query.removeEventListener('change', onChange);
      refresh();
      watchDpr();
    };
    query.addEventListener('change', onChange);
    dprCleanup = () => query.removeEventListener('change', onChange);
  };
  watchDpr();

  renderNow();

  return {
    scene,
    index,
    viewport,
    get renderer() {
      return active;
    },
    setRenderer(next) {
      active.destroy();
      active = next;
      active.mount(host);
      builder.reset(); // next frame reports everything added → full repaint
      renderNow();
    },
    refresh,
    renderNow,
    destroy() {
      if (destroyed) return;
      destroyed = true;
      if (rafHandle !== null && typeof cancelAnimationFrame === 'function') {
        cancelAnimationFrame(rafHandle);
      }
      for (const off of subscriptions) off();
      resizeObserver?.disconnect();
      dprCleanup?.();
      scene.destroy();
      active.destroy();
    },
  };
}
