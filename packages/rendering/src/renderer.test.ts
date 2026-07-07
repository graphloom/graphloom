// @vitest-environment jsdom
import { commands, createGraph } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { rendererConformanceChecks, runRendererConformance } from './conformance.js';
import { mountRenderer } from './host.js';
import { createMockRenderer, hitTestFrame } from './renderer.js';

describe('renderer conformance suite (mock renderer, P3-T06 acceptance)', () => {
  for (const check of rendererConformanceChecks) {
    it(check.name, () => {
      check.run(createMockRenderer);
    });
  }

  it('runRendererConformance aggregates all checks', () => {
    expect(() => runRendererConformance(createMockRenderer)).not.toThrow();
  });

  it('catches a broken renderer (control)', () => {
    const broken = (): ReturnType<typeof createMockRenderer> => {
      const renderer = createMockRenderer();
      return { ...renderer, hitTest: () => null }; // picking disabled
    };
    expect(() => runRendererConformance(broken)).toThrow(/conformance/);
  });
});

describe('hitTestFrame', () => {
  it('returns null without a frame', () => {
    expect(hitTestFrame(null, { x: 0, y: 0 })).toBeNull();
  });
});

describe('mountRenderer host lifecycle', () => {
  const setup = () => {
    const element = document.createElement('div');
    Object.defineProperty(element, 'clientWidth', { value: 800 });
    Object.defineProperty(element, 'clientHeight', { value: 600 });
    document.body.appendChild(element);
    const editor = createGraph();
    editor.execute(
      commands.nodeAdd({ id: 'a', position: { x: 10, y: 10 }, size: { width: 50, height: 50 } }),
    );
    const renderer = createMockRenderer();
    const host = mountRenderer(editor, renderer, element);
    return { element, editor, renderer, host };
  };

  it('renders immediately on mount and sizes the viewport from the host', () => {
    const { host, renderer } = setup();
    expect(renderer.lastFrame).not.toBeNull();
    expect(renderer.lastFrame?.items.map((i) => i.id)).toEqual(['node:a']);
    expect(host.viewport.size).toEqual({ width: 800, height: 600 });
    host.destroy();
  });

  it('coalesces refreshes into one rAF render', async () => {
    const { host, editor, renderer } = setup();
    const framesBefore = renderer.lastFrame;
    editor.execute(commands.nodeUpdate('a', { position: { x: 20, y: 20 } }));
    editor.execute(commands.nodeUpdate('a', { position: { x: 30, y: 30 } }));
    // Model changes only schedule; the frame lands on the next animation frame.
    expect(renderer.lastFrame).toBe(framesBefore);
    await new Promise((resolve) => requestAnimationFrame(() => resolve(null)));
    const shape = renderer.lastFrame?.items.find((i) => i.id === 'node:a');
    expect(shape?.kind === 'shape' && shape.rect.x).toBe(30);
    host.destroy();
  });

  it('renderNow cancels a pending rAF and renders synchronously', () => {
    const { host, editor, renderer } = setup();
    editor.execute(commands.nodeUpdate('a', { position: { x: 99, y: 0 } }));
    const frame = host.renderNow();
    expect(renderer.lastFrame).toBe(frame);
    host.destroy();
  });

  it('swaps renderers in place losslessly', () => {
    const { host } = setup();
    const second = createMockRenderer();
    host.setRenderer(second);
    expect(host.renderer).toBe(second);
    expect(second.lastFrame?.items.map((i) => i.id)).toEqual(['node:a']);
    // Full repaint after swap: everything reported added.
    expect(second.lastFrame?.dirty.added).toEqual(['node:a']);
    host.destroy();
  });

  it('destroy() stops rendering and is idempotent', () => {
    const { host, editor, renderer } = setup();
    host.destroy(); // destroys the renderer too → lastFrame cleared
    expect(renderer.lastFrame).toBeNull();
    editor.execute(commands.nodeUpdate('a', { position: { x: 77, y: 77 } }));
    host.refresh();
    expect(renderer.lastFrame).toBeNull(); // nothing rendered after teardown
    host.destroy(); // second call is a no-op
  });
});
