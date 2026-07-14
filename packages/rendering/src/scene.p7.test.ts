// Phase 7 scene features: theming (T07), labels (T04), visual states (T08).
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { createTheme, darkTheme, lightTheme } from '@graphloom/themes';
import { describe, expect, it } from 'vitest';
import { SceneGraph, type PathRenderItem, type TextRenderItem } from './scene.js';
import { routePointAt } from './routing.js';

const setup = (): { editor: GraphEditor; scene: SceneGraph } => {
  const editor = createGraph();
  const scene = new SceneGraph(editor);
  return { editor, scene };
};

describe('theme engine in the scene (P7-T07)', () => {
  it('defaults to the light theme with the pre-P7 default styles (pixel parity)', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeAdd({ id: 'a', data: { label: 'A' } }));
    expect(scene.theme).toBe(lightTheme);
    expect(scene.get('node:a')?.style).toEqual({
      fill: '#e8eefc',
      stroke: '#3b5bd9',
      strokeWidth: 1.5,
      fontFamily: 'system-ui, sans-serif',
      fontSize: 12,
      textColor: '#1a1f36',
    });
  });

  it('setTheme restyles the whole scene without any model events or history entries', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b', position: { x: 300, y: 0 } }));
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    const events: string[] = [];
    editor.on('graph.change', () => events.push('graph.change'));
    const before = scene.revision;

    scene.setTheme(darkTheme);

    expect(scene.theme).toBe(darkTheme);
    expect(scene.revision).toBeGreaterThan(before); // renderers get dirty items
    expect(events).toEqual([]); // nothing entered the command pipeline
    expect(scene.get('node:a')?.style.fill).toBe(darkTheme.tokens.nodeFill);
    expect(scene.get('edge:e')?.style.stroke).toBe(darkTheme.tokens.edgeStroke);

    // Dirty sets flag every element as updated so a renderer repaints them.
    scene.setTheme(darkTheme); // same theme → no-op
    const revision = scene.revision;
    scene.setTheme(createTheme('brand', { nodeFill: '#123123' }, darkTheme));
    expect(scene.revision).toBeGreaterThan(revision);
    expect(scene.get('node:a')?.style.fill).toBe('#123123');
  });

  it('scene options accept a custom starting theme', () => {
    const editor = createGraph();
    const scene = new SceneGraph(editor, { theme: darkTheme });
    editor.execute(commands.nodeAdd({ id: 'a' }));
    expect(scene.get('node:a')?.style.fill).toBe(darkTheme.tokens.nodeFill);
  });
});

describe('node visual states (P7-T08)', () => {
  it('selection/hover/dragging feed shape descriptors; clearing resets', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeAdd({ id: 'a' }));
    const atRest = scene.get('node:a')?.style;

    scene.setVisualStates(new Map([['a', { selected: true, hovered: false, dragging: false }]]));
    expect(scene.get('node:a')?.style.stroke).toBe(lightTheme.tokens.selectionStroke);
    expect(scene.get('node:a')?.style.strokeWidth).toBe(lightTheme.tokens.selectionStrokeWidth);

    scene.setVisualStates(new Map([['a', { selected: false, hovered: true, dragging: false }]]));
    expect(scene.get('node:a')?.style.stroke).toBe(lightTheme.tokens.hoverStroke);

    scene.setVisualStates(new Map([['a', { selected: false, hovered: false, dragging: true }]]));
    expect(scene.get('node:a')?.style.opacity).toBe(lightTheme.tokens.draggingOpacity);

    scene.setVisualStates(new Map());
    expect(scene.get('node:a')?.style).toEqual(atRest);
  });

  it('locked nodes dim via the theme token (state input from the model)', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeAdd({ id: 'a', locked: true }));
    expect(scene.get('node:a')?.style.opacity).toBe(lightTheme.tokens.lockedOpacity);
  });

  it('selected edges restyle too', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b', position: { x: 300, y: 0 } }));
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
    scene.setVisualStates(new Map([['e', { selected: true, hovered: false, dragging: false }]]));
    expect(scene.get('edge:e')?.style.stroke).toBe(lightTheme.tokens.selectionStroke);
  });
});

describe('labels (P7-T04)', () => {
  it('long inside labels wrap at the node width via the text service', () => {
    const { editor, scene } = setup();
    editor.execute(
      commands.nodeAdd({
        id: 'a',
        size: { width: 80, height: 40 },
        data: { label: 'a rather long label that cannot fit one line' },
      }),
    );
    const lines = scene
      .items()
      .filter((i) => i.kind === 'text')
      .map((i) => (i as TextRenderItem).text);
    expect(lines.length).toBeGreaterThan(1);
    expect(scene.get('label:node:a')).toBeDefined();
    expect(scene.get('label:node:a:l1')).toBeDefined();
    // The block stays centered on the node.
    const first = scene.get('label:node:a') as TextRenderItem;
    const last = scene.get(`label:node:a:l${lines.length - 1}`) as TextRenderItem;
    expect((first.position.y + last.position.y) / 2).toBeCloseTo(20);
  });

  it('labelPosition outside places the label below the (rotated) body', () => {
    const { editor, scene } = setup();
    editor.execute(
      commands.nodeAdd({
        id: 'a',
        size: { width: 100, height: 40 },
        data: { label: 'below', labelPosition: 'outside' },
      }),
    );
    const label = scene.get('label:node:a') as TextRenderItem;
    expect(label.position.x).toBe(50);
    expect(label.position.y).toBeGreaterThan(40); // under the body
  });

  it('edge labels follow the route midpoint through reroutes (acceptance)', () => {
    const { editor, scene } = setup();
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b', position: { x: 300, y: 200 } }));
    editor.execute(
      commands.edgeAdd({
        id: 'e',
        source: 'a',
        target: 'b',
        routing: 'bezier',
        labels: [{ text: 'mid', position: 0.5 }],
      }),
    );
    const at = (): { x: number; y: number } =>
      (scene.get('label:edge:e:0') as TextRenderItem).position;
    const path = (): PathRenderItem => scene.get('edge:e') as PathRenderItem;
    expect(at()).toEqual(routePointAt({ curve: 'cubic', points: path().points }, 0.5));

    // Reroute 1: move the target — the label tracks the new midpoint.
    editor.execute(commands.nodeUpdate('b', { position: { x: 600, y: -100 } }));
    expect(at()).toEqual(routePointAt({ curve: 'cubic', points: path().points }, 0.5));

    // Reroute 2: change the routing kind entirely.
    editor.execute(commands.edgeUpdate('e', { routing: 'orthogonal' }));
    expect(at()).toEqual(routePointAt({ curve: 'polyline', points: path().points }, 0.5));
  });
});
