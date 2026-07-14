import { commands, createGraph, type PortSide } from '@graphloom/core';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { applyToPoint, rotationAbout } from './geometry.js';
import { edgeAnchor, SceneGraph, type PathRenderItem } from './scene.js';

const sides: PortSide[] = ['top', 'right', 'bottom', 'left'];

/** The side/offset anchor computed independently of edgeAnchor. */
function expectedAnchor(
  position: { x: number; y: number },
  size: { width: number; height: number },
  rotation: number,
  side: PortSide,
  offset: number,
): { x: number; y: number } {
  const local =
    side === 'top'
      ? { x: position.x + offset * size.width, y: position.y }
      : side === 'bottom'
        ? { x: position.x + offset * size.width, y: position.y + size.height }
        : side === 'left'
          ? { x: position.x, y: position.y + offset * size.height }
          : { x: position.x + size.width, y: position.y + offset * size.height };
  if (rotation % 360 === 0) return local;
  return applyToPoint(
    rotationAbout(rotation, position.x + size.width / 2, position.y + size.height / 2),
    local,
  );
}

describe('ports & anchoring (P7-T03)', () => {
  it('fuzz: edges stay attached to port anchors under arbitrary move/resize/rotate', () => {
    fc.assert(
      fc.property(
        fc.record({
          x: fc.integer({ min: -1000, max: 1000 }),
          y: fc.integer({ min: -1000, max: 1000 }),
          width: fc.integer({ min: 1, max: 500 }),
          height: fc.integer({ min: 1, max: 500 }),
          rotation: fc.integer({ min: -720, max: 720 }),
          side: fc.constantFrom(...sides),
          offset: fc.float({ min: 0, max: 1, noNaN: true }),
        }),
        ({ x, y, width, height, rotation, side, offset }) => {
          const editor = createGraph();
          const scene = new SceneGraph(editor);
          editor.execute(
            commands.nodeAdd({
              id: 'a',
              ports: [{ id: 'p', side, offset }],
            }),
          );
          editor.execute(commands.nodeAdd({ id: 'b', position: { x: 2000, y: 2000 } }));
          editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b', sourcePort: 'p' }));
          // The transform under test, applied as a live model update.
          editor.execute(
            commands.nodeUpdate('a', {
              position: { x, y },
              size: { width, height },
              rotation,
            }),
          );
          const path = scene.get('edge:e') as PathRenderItem;
          const anchor = expectedAnchor({ x, y }, { width, height }, rotation, side, offset);
          expect(path.points[0]!.x).toBeCloseTo(anchor.x, 6);
          expect(path.points[0]!.y).toBeCloseTo(anchor.y, 6);
        },
      ),
      { numRuns: 60 },
    );
  });

  it('spec anchors refine same-id model ports (dynamic per-shape anchors)', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    // Triangle declares its left anchor on the slope at (w/4, h/2).
    editor.execute(
      commands.nodeAdd({
        id: 't',
        type: 'triangle',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 100 },
        ports: [{ id: 'left', side: 'left', offset: 0.5 }],
      }),
    );
    editor.execute(commands.nodeAdd({ id: 'b', position: { x: -300, y: 0 } }));
    editor.execute(commands.edgeAdd({ id: 'e', source: 't', target: 'b', sourcePort: 'left' }));
    const path = scene.get('edge:e') as PathRenderItem;
    // Bounding-box side would be (0,50); the shape anchor is (25,50).
    expect(path.points[0]).toEqual({ x: 25, y: 50 });
  });

  it('rotated-node port anchors are correct (acceptance case)', () => {
    const editor = createGraph();
    editor.execute(
      commands.nodeAdd({
        id: 'r',
        position: { x: 0, y: 0 },
        size: { width: 100, height: 40 },
        rotation: 90,
        ports: [{ id: 'p', side: 'right', offset: 0.5 }],
      }),
    );
    const node = editor.graph.getNode('r')!;
    // Right-center (100,20) rotated 90° about (50,20) → (50,70).
    const anchor = edgeAnchor(node, 'p');
    expect(anchor.x).toBeCloseTo(50);
    expect(anchor.y).toBeCloseTo(70);
  });

  it('unknown ports and portless edges anchor at the node center', () => {
    const editor = createGraph();
    editor.execute(commands.nodeAdd({ id: 'a', position: { x: 10, y: 10 } }));
    const node = editor.graph.getNode('a')!;
    expect(edgeAnchor(node, undefined)).toEqual({ x: 60, y: 30 });
    expect(edgeAnchor(node, 'ghost')).toEqual({ x: 60, y: 30 });
  });
});

describe('port visibility rules (P7-T03)', () => {
  const setup = () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    editor.execute(
      commands.nodeAdd({
        id: 'n',
        ports: [
          { id: 'shown', side: 'right', visibility: 'always' },
          { id: 'onHover', side: 'left' }, // default: hover
          { id: 'never', side: 'top', visibility: 'never' },
        ],
      }),
    );
    return { editor, scene };
  };

  it('always-ports render at rest; hover-ports only while hovered; never-ports never', () => {
    const { scene } = setup();
    expect(scene.get('port:node:n:shown')).toBeDefined();
    expect(scene.get('port:node:n:onHover')).toBeUndefined();
    expect(scene.get('port:node:n:never')).toBeUndefined();

    scene.setVisualStates(new Map([['n', { selected: false, hovered: true, dragging: false }]]));
    expect(scene.get('port:node:n:onHover')).toBeDefined();
    expect(scene.get('port:node:n:never')).toBeUndefined();

    scene.setVisualStates(new Map());
    expect(scene.get('port:node:n:onHover')).toBeUndefined();
    expect(scene.get('port:node:n:shown')).toBeDefined();
  });

  it('port dots track the node transform', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeUpdate('n', { position: { x: 500, y: 500 } }));
    const port = scene.get('port:node:n:shown');
    expect(port).toMatchObject({ kind: 'port', center: { x: 600, y: 520 } });
  });
});
