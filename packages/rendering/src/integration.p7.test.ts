// Phase 7 exit scenario, headless: every built-in shape × both themes, every
// edge geometry, markers, ports, visual states — derived through the real
// scene pipeline and validated end to end (no DOM, no renderer).
import {
  commands,
  createGraph,
  validateShapeSpec,
  DEFAULT_VISUAL_STATE,
  type GraphEditor,
  type VisualState,
} from '@graphloom/core';
import { darkTheme, lightTheme } from '@graphloom/themes';
import { describe, expect, it } from 'vitest';
import { SceneGraph, type PathRenderItem } from './scene.js';
import { resolveShapeDescriptor } from './shapes.js';
import { SpatialIndex } from './spatial.js';

const SHAPES = [
  'rectangle',
  'rounded-rectangle',
  'circle',
  'diamond',
  'triangle',
  'hexagon',
  'database',
  'cylinder',
  'queue',
  'cloud',
  'folder',
  'document',
  'person',
  'server',
  'api',
  'storage',
  'container',
  'image',
  'svg',
  'icon',
] as const;

function buildShowcase(): { editor: GraphEditor; scene: SceneGraph; index: SpatialIndex } {
  const editor = createGraph();
  const scene = new SceneGraph(editor);
  const index = new SpatialIndex(scene);
  editor.transact(() => {
    SHAPES.forEach((type, i) => {
      const col = i % 5;
      const row = Math.floor(i / 5);
      editor.execute(
        commands.nodeAdd({
          id: `s-${type}`,
          type,
          position: { x: col * 220, y: row * 160 },
          size: { width: 140, height: 90 },
          rotation: i % 7 === 0 ? 30 : 0,
          data: { label: type },
          ports: [
            { id: 'right', side: 'right', visibility: 'always' },
            { id: 'left', side: 'left' },
          ],
        }),
      );
    });
    // Every routing kind, with labels and markers.
    const pairs: Array<[string, string, 'straight' | 'orthogonal' | 'bezier' | 'smooth']> = [
      ['s-rectangle', 's-rounded-rectangle', 'straight'],
      ['s-circle', 's-diamond', 'bezier'],
      ['s-triangle', 's-hexagon', 'orthogonal'],
      ['s-database', 's-queue', 'smooth'],
    ];
    pairs.forEach(([source, target, routing], i) => {
      editor.execute(
        commands.edgeAdd({
          id: `e-${routing}`,
          source,
          target,
          sourcePort: 'right',
          targetPort: 'left',
          routing,
          labels: [{ text: routing, position: 0.5 }],
          data: i % 2 === 0 ? { markerEnd: 'arrow', markerStart: 'circle' } : {},
        }),
      );
    });
    // Parallel pair (fanning) and a self-loop.
    editor.execute(commands.edgeAdd({ id: 'p1', source: 's-cloud', target: 's-folder' }));
    editor.execute(commands.edgeAdd({ id: 'p2', source: 's-cloud', target: 's-folder' }));
    editor.execute(
      commands.edgeAdd({ id: 'self', source: 's-server', target: 's-server', data: { markerEnd: 'arrow' } }),
    );
  });
  return { editor, scene, index };
}

describe('Phase 7 exit: shape system & theming, end to end (headless)', () => {
  it('every shape × both themes × every state produces a valid ShapeSpec', () => {
    const { editor } = buildShowcase();
    const states: VisualState[] = [
      DEFAULT_VISUAL_STATE,
      { selected: true, hovered: false, dragging: false },
      { selected: false, hovered: true, dragging: false },
      { selected: false, hovered: false, dragging: true },
    ];
    for (const type of SHAPES) {
      const node = editor.graph.getNode(`s-${type}`)!;
      for (const theme of [lightTheme, darkTheme]) {
        for (const state of states) {
          const spec = resolveShapeDescriptor(type)(node, theme, state);
          const problems = validateShapeSpec(spec);
          expect(problems, `${type}/${theme.name}: ${problems.join('; ')}`).toEqual([]);
          expect(spec.label).toBe(type);
        }
      }
    }
  });

  it('the scene derives finite, hit-testable geometry for the whole showcase', () => {
    const { editor, scene, index } = buildShowcase();
    expect(scene.items().length).toBeGreaterThan(SHAPES.length * 2); // bodies + labels + ports + edges
    for (const item of scene.items()) {
      for (const value of [item.bounds.x, item.bounds.y, item.bounds.width, item.bounds.height]) {
        expect(Number.isFinite(value), item.id).toBe(true);
      }
    }
    // Every node is pickable at its center through the shared spatial pick.
    for (const type of SHAPES) {
      const node = editor.graph.getNode(`s-${type}`)!;
      const center = {
        x: node.position.x + node.size.width / 2,
        y: node.position.y + node.size.height / 2,
      };
      const hits = index.hitTestAll(center, { tolerance: 1 });
      expect(
        hits.some((h) => h.elementId === node.id),
        `${type} center should hit its own node`,
      ).toBe(true);
    }
    // Parallel edges fanned apart deterministically.
    const p1 = scene.get('edge:p1') as PathRenderItem;
    const p2 = scene.get('edge:p2') as PathRenderItem;
    expect(p1.curve).toBe('cubic');
    expect(p1.points).not.toEqual(p2.points);
    // The self-loop starts and ends at the same anchor and carries its marker.
    const loop = scene.get('edge:self') as PathRenderItem;
    expect(loop.points[0]).toEqual(loop.points[loop.points.length - 1]);
    expect(scene.get('marker:edge:self:end')).toBeDefined();
    // Always-visible ports exist for every node.
    for (const type of SHAPES) expect(scene.get(`port:node:s-${type}:right`)).toBeDefined();
  });

  it('live theme switching restyles everything with zero model/history traffic', () => {
    const { editor, scene } = buildShowcase();
    const events: string[] = [];
    editor.on('graph.change', () => events.push('change'));
    const lightFills = new Map(scene.items().map((i) => [i.id, i.style] as const));

    scene.setTheme(darkTheme);
    expect(events).toEqual([]);
    expect(scene.get('node:s-rectangle')?.style.fill).toBe(darkTheme.tokens.nodeFill);
    expect(scene.get('edge:e-straight')?.style.stroke).toBe(darkTheme.tokens.edgeStroke);

    scene.setTheme(lightTheme);
    expect(events).toEqual([]);
    // Round-trip: identical styles again (stable derivation).
    for (const item of scene.items()) {
      expect(item.style, item.id).toEqual(lightFills.get(item.id));
    }
  });

  it('selection state propagates through descriptors on top of any theme', () => {
    const { scene } = buildShowcase();
    scene.setTheme(darkTheme);
    scene.setVisualStates(
      new Map(SHAPES.map((type) => [`s-${type}`, { selected: true, hovered: false, dragging: false }])),
    );
    for (const type of SHAPES) {
      expect(scene.get(`node:s-${type}`)?.style.stroke, type).toBe(darkTheme.tokens.selectionStroke);
    }
  });
});
