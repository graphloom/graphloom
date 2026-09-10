// @vitest-environment jsdom
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { createSvgRenderer, mountRenderer, type RenderHost } from '@graphloom/rendering';
import { afterEach, describe, expect, it } from 'vitest';
import { minimap } from './plugin.js';

const sized = (w: number, h: number): HTMLElement => {
  const el = document.createElement('div');
  Object.defineProperty(el, 'clientWidth', { value: w, configurable: true });
  Object.defineProperty(el, 'clientHeight', { value: h, configurable: true });
  document.body.appendChild(el);
  return el;
};

const addNode = (editor: GraphEditor, id: string, x: number, y: number): void => {
  editor.execute(
    commands.nodeAdd({ id, position: { x, y }, size: { width: 80, height: 40 } }),
  );
};

describe('minimap plugin', () => {
  let host: RenderHost;
  let hostEl: HTMLElement;
  let mount: HTMLElement;

  afterEach(() => {
    host.destroy();
    hostEl.remove();
    mount.remove();
  });

  const build = (): GraphEditor => {
    const editor = createGraph();
    addNode(editor, 'a', 0, 0);
    hostEl = sized(800, 600);
    host = mountRenderer(editor, createSvgRenderer(), hostEl);
    mount = sized(200, 150);
    return editor;
  };

  it('installs through editor.use() and emits plugin.loaded', () => {
    const editor = build();
    const loaded: string[] = [];
    editor.on('plugin.loaded', ({ pluginId }) => loaded.push(pluginId));

    editor.use(minimap({ host, mount }));

    expect(editor.plugins()).toContain('minimap');
    expect(loaded).toContain('minimap');
    expect(mount.querySelector('canvas')).not.toBeNull();
  });

  it('keeps mirroring model edits while installed', () => {
    const editor = build();
    editor.use(minimap({ host, mount }));
    expect(() => addNode(editor, 'far', 5000, 5000)).not.toThrow();
    expect(editor.plugins()).toContain('minimap');
  });

  it('passes options through to the minimap', () => {
    const editor = build();
    editor.use(minimap({ host, mount, options: { className: 'mm-plug' } }));
    expect(mount.querySelector('.mm-plug')).not.toBeNull();
  });

  it('tears the minimap down on editor.unuse() — no stale renderer afterwards', () => {
    const editor = build();
    editor.use(minimap({ host, mount }));

    editor.unuse('minimap');

    expect(editor.plugins()).not.toContain('minimap');
    expect(mount.querySelector('canvas')).toBeNull();
    // A leaked watch subscription would call render() on the destroyed
    // renderer here and throw.
    expect(() => addNode(editor, 'later', 9000, 9000)).not.toThrow();
  });
});
