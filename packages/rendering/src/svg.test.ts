// @vitest-environment jsdom
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { rendererConformanceChecks } from './conformance.js';
import { mountRenderer, type RenderHost } from './host.js';
import { createSvgRenderer } from './svg.js';

const setup = (): { editor: GraphEditor; host: RenderHost; element: HTMLElement } => {
  const element = document.createElement('div');
  Object.defineProperty(element, 'clientWidth', { value: 800 });
  Object.defineProperty(element, 'clientHeight', { value: 600 });
  document.body.appendChild(element);
  const editor = createGraph();
  const host = mountRenderer(editor, createSvgRenderer(), element);
  return { editor, host, element };
};

const itemElements = (element: HTMLElement): Element[] => [
  ...element.querySelectorAll('[data-layer="edges"] > *, [data-layer="nodes"] > *'),
];

const addNode = (
  editor: GraphEditor,
  id: string,
  x: number,
  y: number,
  extra: Record<string, unknown> = {},
): void => {
  editor.execute(
    commands.nodeAdd({ id, position: { x, y }, size: { width: 100, height: 40 }, ...extra }),
  );
};

describe('SVG renderer conformance (P3-T07 acceptance)', () => {
  for (const check of rendererConformanceChecks) {
    it(check.name, () => {
      check.run(createSvgRenderer);
    });
  }
});

describe('SVG renderer structure and patching', () => {
  it('creates layer groups and defs on mount', () => {
    const { element, host } = setup();
    const svg = element.querySelector('svg');
    expect(svg).not.toBeNull();
    expect(svg?.querySelector('defs marker')).not.toBeNull();
    for (const layer of ['background', 'world', 'edges', 'nodes', 'overlay']) {
      expect(svg?.querySelector(`[data-layer="${layer}"]`)).not.toBeNull();
    }
    host.destroy();
    expect(element.querySelector('svg')).toBeNull();
  });

  it('DOM element count equals visible item count (virtualization proof)', () => {
    const { editor, host, element } = setup();
    for (let i = 0; i < 12; i++) {
      addNode(editor, `n${i}`, i * 200, 100, { data: { label: `N${i}` } });
    }
    editor.execute(commands.edgeAdd({ id: 'e', source: 'n0', target: 'n1' }));
    const frame = host.renderNow();
    // Only items within viewport+margin exist in the DOM at all.
    expect(itemElements(element)).toHaveLength(frame.items.length);
    expect(frame.items.length).toBeLessThan(25); // culling actually dropped some

    // Zooming out brings more into view; the DOM tracks exactly.
    host.viewport.setViewport({ x: 0, y: 0, zoom: 0.45 });
    const zoomedOut = host.renderNow();
    expect(zoomedOut.items.length).toBeGreaterThan(frame.items.length);
    expect(itemElements(element)).toHaveLength(zoomedOut.items.length);
    host.destroy();
  });

  it('patches only dirty items in place', () => {
    const { editor, host, element } = setup();
    addNode(editor, 'a', 10, 10);
    addNode(editor, 'b', 300, 10);
    host.renderNow();
    const rectA = element.querySelector('[data-item="node:a"]');
    const rectB = element.querySelector('[data-item="node:b"]');
    editor.execute(commands.nodeUpdate('a', { position: { x: 50, y: 60 } }));
    host.renderNow();
    // Same element instances — 'a' repositioned, 'b' untouched.
    expect(element.querySelector('[data-item="node:a"]')).toBe(rectA);
    expect(element.querySelector('[data-item="node:b"]')).toBe(rectB);
    expect(rectA?.getAttribute('x')).toBe('50');
    expect(rectA?.getAttribute('y')).toBe('60');
    editor.execute(commands.nodeRemove('a'));
    host.renderNow();
    expect(element.querySelector('[data-item="node:a"]')).toBeNull();
    host.destroy();
  });

  it('applies pan/zoom as one world transform', () => {
    const { host, element } = setup();
    host.viewport.setViewport({ x: -120, y: 35, zoom: 2.5 });
    host.renderNow();
    expect(element.querySelector('[data-layer="world"]')?.getAttribute('transform')).toBe(
      'translate(-120 35) scale(2.5)',
    );
    host.destroy();
  });

  it('renders shapes, rotations, ellipses, paths, and labels correctly', () => {
    const { editor, host, element } = setup();
    addNode(editor, 'r', 0, 0, { rotation: 45, data: { label: 'spin' } });
    addNode(editor, 'o', 300, 0, { type: 'ellipse' });
    editor.execute(
      commands.edgeAdd({ id: 'c', source: 'r', target: 'o', routing: 'bezier' }),
    );
    editor.execute(
      commands.edgeAdd({ id: 'z', source: 'r', target: 'o', routing: 'orthogonal' }),
    );
    host.renderNow();
    expect(element.querySelector('[data-item="node:r"]')?.getAttribute('transform')).toBe(
      'rotate(45 50 20)',
    );
    expect(element.querySelector('[data-item="node:o"]')?.tagName).toBe('ellipse');
    expect(element.querySelector('[data-item="edge:c"]')?.getAttribute('d')).toContain('C');
    expect(element.querySelector('[data-item="edge:z"]')?.getAttribute('d')).toMatch(/^M .* L /);
    expect(element.querySelector('[data-item="label:node:r"]')?.textContent).toBe('spin');
    expect(element.querySelector('[data-item="edge:c"]')?.getAttribute('marker-end')).toMatch(
      /^url\(#graphloom-arrow-/,
    );
    host.destroy();
  });

  it('keeps DOM paint order in sync with zIndex changes', () => {
    const { editor, host, element } = setup();
    addNode(editor, 'a', 0, 0);
    addNode(editor, 'b', 50, 20);
    host.renderNow();
    const order = (): string[] =>
      [...element.querySelectorAll('[data-layer="nodes"] > *')].map(
        (child) => child.getAttribute('data-item') as string,
      );
    expect(order()).toEqual(['node:a', 'node:b']);
    editor.execute({ type: 'z.reorder', payload: { id: 'a', zIndex: 10 } });
    host.renderNow();
    expect(order()).toEqual(['node:b', 'node:a']);
    host.destroy();
  });

  it('renders a zoom-adaptive grid in viewport space (P3-T09)', () => {
    const { host, element } = setup();
    const renderer = host.renderer as ReturnType<typeof createSvgRenderer>;
    const background = (): Element | null =>
      element.querySelector('[data-layer="background"]');

    // Default: visible dot grid, 20 world units at zoom 1 → 20px cells.
    let pattern = background()?.querySelector('pattern');
    expect(pattern?.getAttribute('width')).toBe('20');
    expect(pattern?.querySelector('circle')).not.toBeNull();

    // Deep zoom-out doubles the cell until it spans ≥ 12 screen px.
    host.viewport.setViewport({ x: 0, y: 0, zoom: 0.1 }); // 2px → ×8 = 16px
    host.renderNow();
    expect(background()?.querySelector('pattern')?.getAttribute('width')).toBe('16');

    // Panning scrolls the pattern via its offset (translate mod cell).
    host.viewport.setViewport({ x: -30, y: 7, zoom: 1 });
    host.renderNow();
    pattern = background()?.querySelector('pattern');
    expect(pattern?.getAttribute('x')).toBe('10'); // (−30 mod 20 + 20) mod 20
    expect(pattern?.getAttribute('y')).toBe('7');

    // Line style swaps the cell content; config API repaints immediately.
    renderer.setGrid({ style: 'line', size: 40 });
    pattern = background()?.querySelector('pattern');
    expect(pattern?.getAttribute('width')).toBe('40');
    expect(pattern?.querySelector('path')).not.toBeNull();

    // Disabled grid renders nothing at all.
    renderer.setGrid({ visible: false });
    expect(background()?.childNodes).toHaveLength(0);
    expect(renderer.grid.visible).toBe(false);
    host.destroy();
  });

  it('dot LOD drops strokes and markers', () => {
    const { editor, host, element } = setup();
    addNode(editor, 'a', 0, 0);
    addNode(editor, 'b', 500, 0);
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    host.renderNow();
    expect(element.querySelector('[data-item="node:a"]')?.getAttribute('stroke')).not.toBeNull();

    host.viewport.setViewport({ x: 0, y: 0, zoom: 0.15 });
    const frame = host.renderNow();
    expect(frame.lod).toBe('dot');
    expect(element.querySelector('[data-item="node:a"]')?.getAttribute('stroke')).toBeNull();
    expect(element.querySelector('[data-item="edge:e"]')?.getAttribute('marker-end')).toBeNull();
    host.destroy();
  });
});
