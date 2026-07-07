import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { FrameBuilder } from './frame.js';
import { inflateRect, rectsIntersect } from './geometry.js';
import { SceneGraph } from './scene.js';
import { SpatialIndex } from './spatial.js';
import { ViewportController } from './viewport.js';

interface World {
  editor: GraphEditor;
  scene: SceneGraph;
  index: SpatialIndex;
  vp: ViewportController;
  builder: FrameBuilder;
}

const setup = (options = {}): World => {
  const editor = createGraph();
  const scene = new SceneGraph(editor);
  const index = new SpatialIndex(scene);
  const vp = new ViewportController({ size: { width: 800, height: 600 } });
  return { editor, scene, index, vp, builder: new FrameBuilder(index, vp, options) };
};

const addNode = (editor: GraphEditor, id: string, x: number, y: number): void => {
  editor.execute(
    commands.nodeAdd({
      id,
      position: { x, y },
      size: { width: 100, height: 40 },
      data: { label: id },
    }),
  );
};

describe('FrameBuilder culling', () => {
  it('frame items match the region query over viewport + margin', () => {
    const { editor, index, vp, builder } = setup();
    addNode(editor, 'in', 100, 100);
    addNode(editor, 'nearby', 850, 100); // outside viewport, inside 100px margin
    addNode(editor, 'far', 3000, 3000);

    const frame = builder.frame();
    const region = inflateRect(vp.visibleWorldRect(), 100);
    expect(frame.items).toEqual(index.query(region));
    expect(frame.items.map((i) => i.id).filter((id) => id.startsWith('node:'))).toEqual([
      'node:in',
      'node:nearby',
    ]);
    expect(frame.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(frame.devicePixelRatio).toBe(1);
  });

  it('entering/leaving the viewport produces added/removed dirty entries', () => {
    const { editor, vp, builder } = setup();
    addNode(editor, 'a', 100, 100);
    addNode(editor, 'far', 2000, 100);

    let frame = builder.frame();
    expect([...frame.dirty.added].sort()).toEqual(['label:node:a', 'node:a']);
    expect(frame.dirty.removed).toEqual([]);

    // Pan so 'far' enters and 'a' leaves (plus its label).
    vp.panBy(-1900, 0);
    frame = builder.frame();
    expect([...frame.dirty.added].sort()).toEqual(['label:node:far', 'node:far']);
    expect([...frame.dirty.removed].sort()).toEqual(['label:node:a', 'node:a']);
    expect(frame.dirty.updated).toEqual([]);
    // No ghosts: removed items are not in the frame.
    const ids = new Set(frame.items.map((i) => i.id));
    expect(ids.has('node:a')).toBe(false);

    // Pan back: 'a' re-enters as added (renderer recreates it).
    vp.panBy(1900, 0);
    frame = builder.frame();
    expect([...frame.dirty.added].sort()).toEqual(['label:node:a', 'node:a']);
  });

  it('model changes show as updates; moving out of view is a removal', () => {
    const { editor, builder } = setup();
    addNode(editor, 'a', 100, 100);
    addNode(editor, 'b', 300, 100);
    builder.frame();

    editor.execute(commands.nodeUpdate('a', { position: { x: 150, y: 150 } }));
    let frame = builder.frame();
    expect([...frame.dirty.updated].sort()).toEqual(['label:node:a', 'node:a']);
    expect(frame.dirty.added).toEqual([]);

    editor.execute(commands.nodeUpdate('b', { position: { x: 5000, y: 5000 } }));
    frame = builder.frame();
    expect([...frame.dirty.removed].sort()).toEqual(['label:node:b', 'node:b']);

    editor.execute(commands.nodeRemove('a'));
    frame = builder.frame();
    expect([...frame.dirty.removed].sort()).toEqual(['label:node:a', 'node:a']);
  });

  it('an unchanged scene and viewport produces an empty dirty set', () => {
    const { editor, builder } = setup();
    addNode(editor, 'a', 100, 100);
    builder.frame();
    const frame = builder.frame();
    expect(frame.dirty).toEqual({ added: [], updated: [], removed: [] });
  });
});

describe('FrameBuilder LOD', () => {
  it('derives lod from zoom thresholds', () => {
    const { vp, builder } = setup();
    expect(builder.lodFor(1)).toBe('full');
    expect(builder.lodFor(0.45)).toBe('simplified');
    expect(builder.lodFor(0.1)).toBe('dot');
    vp.setViewport({ x: 0, y: 0, zoom: 0.3 });
    expect(builder.frame().lod).toBe('simplified');
  });

  it('drops labels below the label threshold', () => {
    const { editor, vp, builder } = setup();
    addNode(editor, 'a', 100, 100);
    expect(builder.frame().items.some((i) => i.kind === 'text')).toBe(true);
    vp.setViewport({ x: 0, y: 0, zoom: 0.3 });
    const frame = builder.frame();
    expect(frame.items.some((i) => i.kind === 'text')).toBe(false);
    expect(frame.dirty.removed).toContain('label:node:a');
  });

  it('a LOD flip marks all surviving items updated', () => {
    const { editor, vp, builder } = setup();
    addNode(editor, 'a', 100, 100);
    builder.frame();
    vp.setViewport({ x: 0, y: 0, zoom: 0.45 }); // full → simplified, labels still on
    const frame = builder.frame();
    expect([...frame.dirty.updated].sort()).toEqual(['label:node:a', 'node:a']);
  });

  it('culling stays correct at any zoom (count matches brute force)', () => {
    const { editor, scene, vp, builder } = setup({ margin: 0 });
    for (let i = 0; i < 30; i++) addNode(editor, `n${i}`, (i % 6) * 400, Math.floor(i / 6) * 300);
    for (const zoom of [0.5, 1, 2, 8]) {
      vp.setViewport({ x: -100, y: -100, zoom });
      const region = vp.visibleWorldRect();
      const expected = scene
        .items()
        .filter((item) => rectsIntersect(item.bounds, region))
        .map((i) => i.id);
      expect(builder.frame().items.map((i) => i.id)).toEqual(expected);
    }
  });

  it('reset() reports everything as added again', () => {
    const { editor, builder } = setup();
    addNode(editor, 'a', 100, 100);
    builder.frame();
    builder.reset();
    expect(builder.frame().dirty.added.length).toBeGreaterThan(0);
  });
});
