// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
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
