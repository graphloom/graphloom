// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createCanvasRenderer } from './canvas.js';
import { rendererConformanceChecks } from './conformance.js';
import type { SceneFrame } from './frame.js';

const stubbedElement = (width: number, height: number): HTMLElement => {
  const element = document.createElement('div');
  // jsdom has no layout: stub the client box mount/render read (matches the
  // conformance suite's withPipeline and the SVG backend's test setup).
  Object.defineProperty(element, 'clientWidth', { value: width, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: height, configurable: true });
  document.body.appendChild(element);
  return element;
};

const emptyFrame = (devicePixelRatio: number): SceneFrame => ({
  items: [],
  dirty: { added: [], updated: [], removed: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  devicePixelRatio,
  lod: 'full',
});

const framePanned = (frame: SceneFrame, viewport: SceneFrame['viewport']): SceneFrame => ({
  ...frame,
  viewport,
});

describe('Canvas renderer conformance (P9-T01 acceptance)', () => {
  for (const check of rendererConformanceChecks) {
    it(check.name, () => {
      check.run(createCanvasRenderer);
    });
  }
});

describe('Canvas renderer structure and HiDPI sizing', () => {
  // jsdom has no real 2D context (`getContext('2d')` returns null — same gap
  // `text.ts`'s SSR-safe measurer already works around), so paint dispatch,
  // the dirty-region-vs-full-frame heuristic, and image bitmap caching only
  // execute pixels in a real browser. This file proves the DOM-observable
  // contract (lifecycle, backing-store sizing); pixel/visual proof is the
  // close-out e2e pass alongside P9-T02's parity verification.

  it('mounts a single canvas element and destroy detaches it', () => {
    const element = stubbedElement(800, 600);
    const renderer = createCanvasRenderer();
    renderer.mount(element);
    const canvas = element.querySelector('canvas');
    expect(canvas).not.toBeNull();
    expect(canvas?.getAttribute('data-graphloom')).toBe('canvas');
    renderer.destroy();
    expect(element.childNodes.length).toBe(0);
    element.remove();
  });

  it('sizes the backing store from host CSS size × devicePixelRatio', () => {
    const element = stubbedElement(800, 600);
    const renderer = createCanvasRenderer();
    renderer.mount(element);
    renderer.render(emptyFrame(2));
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(1600);
    expect(canvas.height).toBe(1200);
    expect(canvas.style.width).toBe('800px');
    expect(canvas.style.height).toBe('600px');
    renderer.destroy();
    element.remove();
  });

  it('resizes the backing store when the host size or DPR changes', () => {
    const element = stubbedElement(800, 600);
    const renderer = createCanvasRenderer();
    renderer.mount(element);
    renderer.render(emptyFrame(1));
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(800);

    Object.defineProperty(element, 'clientWidth', { value: 400, configurable: true });
    Object.defineProperty(element, 'clientHeight', { value: 300, configurable: true });
    renderer.render(emptyFrame(1));
    expect(canvas.width).toBe(400);
    expect(canvas.height).toBe(300);

    renderer.render(emptyFrame(3));
    expect(canvas.width).toBe(1200);
    expect(canvas.height).toBe(900);
    renderer.destroy();
    element.remove();
  });

  it('never sizes the backing store to zero on an empty host box', () => {
    const element = stubbedElement(0, 0);
    const renderer = createCanvasRenderer();
    renderer.mount(element);
    renderer.render(emptyFrame(1));
    const canvas = element.querySelector('canvas') as HTMLCanvasElement;
    expect(canvas.width).toBe(1);
    expect(canvas.height).toBe(1);
    renderer.destroy();
    element.remove();
  });
});

describe('Canvas renderer viewport invalidation (P9-T02)', () => {
  // A pan/zoom moves every pixel but marks no items dirty (FrameBuilder keeps
  // object identity across a viewport change), so an immediate-mode backend
  // must repaint the whole frame — otherwise the partial dirty-region path (or
  // the zero-dirty early-return) leaves the previous viewport's pixels on
  // screen. jsdom has no 2D context, so this drives a recording fake and
  // asserts the decision, not the pixels.
  const calls: string[] = [];
  const fakeCtx = new Proxy(
    {},
    {
      get(_t, prop: string) {
        return (...args: unknown[]) => {
          calls.push(`${prop}(${args.join(',')})`);
          if (prop === 'getTransform') return { a: 1, b: 0, c: 0, d: 1, e: 0, f: 0 };
          return undefined;
        };
      },
    },
  ) as unknown as CanvasRenderingContext2D;

  afterEach(() => {
    calls.length = 0;
    vi.restoreAllMocks();
  });

  it('forces a full clear+repaint when the viewport changes with no dirty items', () => {
    vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue(fakeCtx);
    const element = stubbedElement(800, 600);
    const renderer = createCanvasRenderer();
    renderer.mount(element);

    renderer.render(emptyFrame(1)); // initial paint at x:0 y:0 zoom:1
    calls.length = 0;

    // Same scene, panned viewport, zero dirty items.
    renderer.render(framePanned(emptyFrame(1), { x: 120, y: -40, zoom: 2 }));

    // Full-frame path: identity reset + full-canvas clearRect (partial path
    // clears only the dirty region and also calls clip()).
    expect(calls).toContain('clearRect(0,0,800,600)');
    expect(calls.some((c) => c.startsWith('clip('))).toBe(false);
    // The new viewport transform was applied (zoom 2, dpr 1).
    expect(calls).toContain('setTransform(2,0,0,2,120,-40)');

    renderer.destroy();
    element.remove();
  });
});
