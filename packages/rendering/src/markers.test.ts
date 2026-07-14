import { commands, createGraph, type GraphEditor, type MarkerSpec } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { builtinMarkers, resolveMarker } from './markers.js';
import { SceneGraph, type MarkerRenderItem } from './scene.js';
import { darkTheme, lightTheme } from '@graphloom/themes';

const MARKERS = ['arrow', 'open-arrow', 'diamond', 'circle', 'bar', 'crows-foot'] as const;

describe('marker library (P7-T06)', () => {
  it('ships every spec marker, pointing +x with the tip at the origin', () => {
    for (const name of MARKERS) {
      const marker = builtinMarkers.get(name);
      expect(marker, name).toBeDefined();
      for (const segment of marker!.path) {
        if (segment.kind === 'Z') continue;
        // Unit-box discipline: everything behind or at the path end.
        expect(segment.to.x, name).toBeLessThanOrEqual(0);
        expect(Math.abs(segment.to.y), name).toBeLessThanOrEqual(1);
      }
    }
  });

  it('resolves plugin-registered markers before built-ins', () => {
    const custom: MarkerSpec = { path: [{ kind: 'M', to: { x: 0, y: 0 } }], filled: false };
    expect(resolveMarker('arrow', new Map([['arrow', custom]]))).toBe(custom);
    expect(resolveMarker('arrow')).toBe(builtinMarkers.get('arrow'));
    expect(resolveMarker('nope')).toBeUndefined();
  });
});

describe('scene marker items (P7-T06 orientation & theming)', () => {
  const build = (
    routing: 'straight' | 'bezier' | 'orthogonal',
    from: { x: number; y: number },
    to: { x: number; y: number },
  ): { editor: GraphEditor; scene: SceneGraph } => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    editor.execute(
      commands.nodeAdd({ id: 'a', position: { x: from.x - 50, y: from.y - 20 }, size: { width: 100, height: 40 } }),
    );
    editor.execute(
      commands.nodeAdd({ id: 'b', position: { x: to.x - 50, y: to.y - 20 }, size: { width: 100, height: 40 } }),
    );
    editor.execute(
      commands.edgeAdd({
        id: 'e',
        source: 'a',
        target: 'b',
        routing,
        data: { markerStart: 'circle', markerEnd: 'arrow' },
      }),
    );
    return { editor, scene };
  };

  it('places and orients per-end markers on every curve type', () => {
    for (const routing of ['straight', 'bezier', 'orthogonal'] as const) {
      const { scene } = build(routing, { x: 100, y: 100 }, { x: 400, y: 100 });
      const start = scene.get('marker:edge:e:start') as MarkerRenderItem;
      const end = scene.get('marker:edge:e:end') as MarkerRenderItem;
      expect(start, routing).toBeDefined();
      expect(end, routing).toBeDefined();
      expect(start.at).toEqual({ x: 100, y: 100 });
      expect(end.at).toEqual({ x: 400, y: 100 });
      // Horizontal route: end marker points east (0°), start marker west (180°).
      expect(((end.angle % 360) + 360) % 360, routing).toBeCloseTo(0);
      expect(((start.angle % 360) + 360) % 360, routing).toBeCloseTo(180);
      expect(end.marker).toBe('arrow');
      expect(end.filled).toBe(true);
      expect(start.marker).toBe('circle');
    }
  });

  it('orients along the local tangent on bent routes', () => {
    // Vertically aligned orthogonal: the route runs due south into the target.
    const { scene } = build('orthogonal', { x: 100, y: 100 }, { x: 100, y: 300 });
    const end = scene.get('marker:edge:e:end') as MarkerRenderItem;
    expect(((end.angle % 360) + 360) % 360).toBeCloseTo(90); // due south
    const start = scene.get('marker:edge:e:start') as MarkerRenderItem;
    expect(((start.angle % 360) + 360) % 360).toBeCloseTo(270); // out of the path start
  });

  it('markers are theme- and state-aware in color', () => {
    const { editor, scene } = build('straight', { x: 100, y: 100 }, { x: 400, y: 100 });
    const before = scene.get('marker:edge:e:end') as MarkerRenderItem;
    expect(before.style.fill).toBe(lightTheme.tokens.edgeStroke); // filled from stroke

    scene.setTheme(darkTheme);
    const dark = scene.get('marker:edge:e:end') as MarkerRenderItem;
    expect(dark.style.fill).toBe(darkTheme.tokens.edgeStroke);

    scene.setVisualStates(new Map([['e', { selected: true, hovered: false, dragging: false }]]));
    const selected = scene.get('marker:edge:e:end') as MarkerRenderItem;
    expect(selected.style.fill).toBe(darkTheme.tokens.selectionStroke);
    editor.execute(commands.edgeUpdate('e', { data: {} }));
    expect(scene.get('marker:edge:e:end')).toBeUndefined(); // unbound = no marker items
  });

  it('unknown marker names produce no items', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor);
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b', position: { x: 300, y: 0 } }));
    editor.execute(
      commands.edgeAdd({ id: 'e', source: 'a', target: 'b', data: { markerEnd: 'not-a-marker' } }),
    );
    expect(scene.get('marker:edge:e:end')).toBeUndefined();
  });
});
