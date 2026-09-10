import type { Unsubscribe } from '@graphloom/core';
import {
  createCanvasRenderer,
  FrameBuilder,
  ViewportController,
  type RenderHost,
} from '@graphloom/rendering';

/** Tunables for {@link createMinimap}. */
export interface MinimapOptions {
  /** World-unit-ish padding kept around the graph in the fit (default 12). */
  readonly padding?: number;
  /** Class applied to the minimap's root element, for host styling. */
  readonly className?: string;
  /** Class applied to the viewport-rectangle indicator element. */
  readonly indicatorClassName?: string;
}

/** What {@link createMinimap} returns. */
export interface MinimapHandle {
  /** The minimap's own viewport (fitted to the whole graph). */
  readonly viewport: ViewportController;
  /** Re-fits, repaints, and repositions the indicator now. */
  refresh(): void;
  /** Removes the minimap DOM and every subscription it made. */
  destroy(): void;
}

/** Inputs for {@link createMinimap}. */
export interface MinimapConfig {
  /** The primary rendering pipeline the minimap mirrors. */
  readonly host: RenderHost;
  /** Element the minimap mounts into. */
  readonly mount: HTMLElement;
  /**
   * Model-change subscription — `(onModelChange) => unsubscribe`. When given,
   * model edits auto-refresh the minimap; viewport changes are tracked
   * regardless. Typically `(cb) => editor.on('graph.change', cb)`.
   */
  readonly watch?: (onModelChange: () => void) => Unsubscribe;
  /** Optional tunables. */
  readonly options?: MinimapOptions;
}

const DEFAULT_PADDING = 12;

/**
 * A minimap over an existing {@link RenderHost}: a second Canvas renderer fed
 * frames from the *same* scene graph and spatial index at a whole-graph fit
 * zoom (ADR-0002 — "the minimap is just another renderer"), plus a positioned
 * element marking the main viewport's rectangle.
 */
export function createMinimap(config: MinimapConfig): MinimapHandle {
  const { host, mount, watch, options = {} } = config;
  const padding = options.padding ?? DEFAULT_PADDING;

  const root = document.createElement('div');
  root.dataset.graphloom = 'minimap';
  root.style.cssText = 'position:relative;touch-action:none';
  if (options.className !== undefined) root.className = options.className;
  mount.appendChild(root);

  const renderer = createCanvasRenderer();
  renderer.mount(root);

  const indicator = document.createElement('div');
  indicator.dataset.graphloom = 'minimap-indicator';
  indicator.style.cssText = 'position:absolute;pointer-events:none;box-sizing:border-box';
  if (options.indicatorClassName !== undefined) indicator.className = options.indicatorClassName;
  root.appendChild(indicator);

  const viewport = new ViewportController({
    size: { width: mount.clientWidth, height: mount.clientHeight },
    minZoom: 0.0005,
  });
  const builder = new FrameBuilder(host.index, viewport);

  const updateIndicator = (): void => {
    const w = host.viewport.visibleWorldRect();
    const tl = viewport.worldToScreen({ x: w.x, y: w.y });
    const br = viewport.worldToScreen({ x: w.x + w.width, y: w.y + w.height });
    indicator.style.left = `${tl.x}px`;
    indicator.style.top = `${tl.y}px`;
    indicator.style.width = `${br.x - tl.x}px`;
    indicator.style.height = `${br.y - tl.y}px`;
  };

  const refresh = (): void => {
    viewport.setSize({ width: mount.clientWidth, height: mount.clientHeight });
    viewport.zoomToFit(host.scene.bounds(), padding);
    // `FrameBuilder.frame` defaults DPR to 1 when passed `undefined` (SSR), so
    // the bare global is safe — this factory only ever runs client-side.
    renderer.render(builder.frame(globalThis.devicePixelRatio));
    updateIndicator();
  };

  refresh();

  /** Pans the main viewport so the minimap point under the pointer is centred. */
  const navigateTo = (clientX: number, clientY: number): void => {
    const box = root.getBoundingClientRect();
    const target = viewport.screenToWorld({ x: clientX - box.left, y: clientY - box.top });
    const { width, height } = host.viewport.size;
    const { zoom } = host.viewport.viewport;
    host.viewport.setViewport({
      x: width / 2 - target.x * zoom,
      y: height / 2 - target.y * zoom,
      zoom,
    });
  };

  // Press or drag anywhere on the minimap to recentre the main view. Listeners
  // stay on `root` (a drag that leaves the minimap simply pauses until it
  // re-enters) — no pointer capture, no window-level listeners to leak.
  let dragging = false;
  const onPointerDown = (e: PointerEvent): void => {
    dragging = true;
    navigateTo(e.clientX, e.clientY);
  };
  const onPointerMove = (e: PointerEvent): void => {
    if (dragging) navigateTo(e.clientX, e.clientY);
  };
  const onPointerUp = (): void => {
    dragging = false;
  };
  root.addEventListener('pointerdown', onPointerDown);
  root.addEventListener('pointermove', onPointerMove);
  root.addEventListener('pointerup', onPointerUp);

  // A model edit lands as one `graph.change` per transaction (nested
  // transactions flatten), so a synchronous refresh here is one repaint per
  // edit. ponytail: rAF-batch if a non-transactional bulk-execute caller ever
  // shows up in the bench.
  const subs: Unsubscribe[] = [host.viewport.on('viewport.changed', updateIndicator)];
  if (watch) subs.push(watch(refresh));

  return {
    viewport,
    refresh,
    destroy() {
      for (const off of subs) off();
      root.removeEventListener('pointerdown', onPointerDown);
      root.removeEventListener('pointermove', onPointerMove);
      root.removeEventListener('pointerup', onPointerUp);
      renderer.destroy();
      root.remove();
    },
  };
}
