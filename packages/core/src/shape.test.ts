import { describe, expect, it } from 'vitest';
import { createGraph } from './editor.js';
import { commands, createNode } from './builtins.js';
import {
  DEFAULT_VISUAL_STATE,
  SHAPE_SPEC_VERSION,
  validateShapeSpec,
  type MarkerSpec,
  type ShapeDescriptor,
  type ShapeSpec,
} from './shape.js';

const valid: ShapeSpec = {
  role: 'node',
  label: 'A',
  children: [{ kind: 'rect', x: 0, y: 0, width: 100, height: 40 }],
  anchors: [{ id: 'n', position: { x: 50, y: 0 } }],
};

describe('ShapeSpec vocabulary', () => {
  it('is versioned independently (ADR-0004 semantics)', () => {
    expect(SHAPE_SPEC_VERSION).toMatch(/^\d+\.\d+$/);
  });

  it('accepts a well-formed spec', () => {
    expect(validateShapeSpec(valid)).toEqual([]);
  });

  it('rejects missing a11y fields (R7)', () => {
    expect(validateShapeSpec({ ...valid, role: '' })).toContain('role must not be empty');
    expect(validateShapeSpec({ ...valid, label: '' })).toContain('label must not be empty');
  });

  it('rejects an empty shape tree', () => {
    expect(validateShapeSpec({ ...valid, children: [] })).toContain('spec has no primitives');
  });

  it('rejects malformed geometry per primitive kind', () => {
    const bad = (children: ShapeSpec['children']): readonly string[] =>
      validateShapeSpec({ ...valid, children });
    expect(bad([{ kind: 'rect', x: NaN, y: 0, width: 1, height: 1 }])[0]).toMatch(/non-finite/);
    expect(bad([{ kind: 'rect', x: 0, y: 0, width: -1, height: 1 }])[0]).toMatch(/negative/);
    expect(bad([{ kind: 'roundRect', x: 0, y: 0, width: 1, height: 1, radius: -2 }])[0]).toMatch(
      /radius/,
    );
    expect(bad([{ kind: 'ellipse', cx: 0, cy: 0, rx: -1, ry: 1 }])[0]).toMatch(/negative/);
    expect(bad([{ kind: 'polygon', points: [{ x: 0, y: 0 }] }])[0]).toMatch(/3\+ points/);
    expect(bad([{ kind: 'path', segments: [] }])[0]).toMatch(/empty path/);
    expect(bad([{ kind: 'path', segments: [{ kind: 'L', to: { x: 1, y: 1 } }] }])[0]).toMatch(
      /start with M/,
    );
    expect(
      bad([
        {
          kind: 'path',
          segments: [
            { kind: 'M', to: { x: 0, y: 0 } },
            { kind: 'C', c1: { x: NaN, y: 0 }, c2: { x: 0, y: 0 }, to: { x: 1, y: 1 } },
          ],
        },
      ])[0],
    ).toMatch(/non-finite path segment/);
    expect(bad([{ kind: 'text', text: 'x', x: 0, y: 0, overflow: 'wrap' }])[0]).toMatch(
      /requires maxWidth/,
    );
    expect(bad([{ kind: 'text', text: 'x', x: 0, y: 0, maxWidth: 0 }])[0]).toMatch(/positive/);
    expect(bad([{ kind: 'image', href: '', x: 0, y: 0, width: 1, height: 1 }])[0]).toMatch(
      /empty image href/,
    );
    expect(bad([{ kind: 'icon', icon: '', x: 0, y: 0, size: 16 }])[0]).toMatch(/empty icon/);
    expect(bad([{ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 0 }, { x: NaN, y: 1 }] }])[0]).toMatch(
      /non-finite polygon point/,
    );
    expect(bad([{ kind: 'text', text: 'x', x: Infinity, y: 0 }])[0]).toMatch(/non-finite text/);
    expect(bad([{ kind: 'image', href: 'a.png', x: NaN, y: 0, width: 1, height: 1 }])[0]).toMatch(
      /non-finite image/,
    );
    expect(bad([{ kind: 'image', href: 'a.png', x: 0, y: 0, width: -1, height: 1 }])[0]).toMatch(
      /negative size/,
    );
    expect(bad([{ kind: 'icon', icon: 'db', x: 0, y: 0, size: NaN }])[0]).toMatch(
      /non-finite icon/,
    );
    expect(bad([{ kind: 'group', translate: { x: NaN, y: 0 }, children: [] }])[0]).toMatch(
      /non-finite group translate/,
    );
  });

  it('accepts every segment kind and validates Q control points', () => {
    const path = (segments: Parameters<typeof validateShapeSpec>[0]['children']): readonly string[] =>
      validateShapeSpec({ ...valid, children: segments });
    expect(
      path([
        {
          kind: 'path',
          segments: [
            { kind: 'M', to: { x: 0, y: 0 } },
            { kind: 'L', to: { x: 4, y: 0 } },
            { kind: 'Q', c: { x: 6, y: 0 }, to: { x: 6, y: 2 } },
            { kind: 'C', c1: { x: 6, y: 4 }, c2: { x: 4, y: 6 }, to: { x: 0, y: 6 } },
            { kind: 'Z' },
          ],
        },
      ]),
    ).toEqual([]);
    expect(
      path([
        {
          kind: 'path',
          segments: [
            { kind: 'M', to: { x: 0, y: 0 } },
            { kind: 'Q', c: { x: NaN, y: 0 }, to: { x: 1, y: 1 } },
          ],
        },
      ])[0],
    ).toMatch(/non-finite path segment/);
  });

  it('recurses into groups and reports the path to the problem', () => {
    const problems = validateShapeSpec({
      ...valid,
      children: [
        {
          kind: 'group',
          translate: { x: 4, y: 4 },
          children: [{ kind: 'polygon', points: [{ x: 0, y: 0 }, { x: 1, y: 1 }] }],
        },
      ],
    });
    expect(problems[0]).toContain('children[0].children[0]');
  });

  it('rejects duplicate or malformed anchors', () => {
    const anchors = [
      { id: 'a', position: { x: 0, y: 0 } },
      { id: 'a', position: { x: 1, y: 1 } },
    ];
    expect(validateShapeSpec({ ...valid, anchors })).toContain('duplicate anchor id a');
    expect(validateShapeSpec({ ...valid, anchors: [{ id: '', position: { x: 0, y: 0 } }] })).toContain(
      'anchor id must not be empty',
    );
    expect(
      validateShapeSpec({ ...valid, anchors: [{ id: 'b', position: { x: NaN, y: 0 } }] })[0],
    ).toMatch(/non-finite position/);
  });

  it('exposes the at-rest visual state', () => {
    expect(DEFAULT_VISUAL_STATE).toEqual({ selected: false, hovered: false, dragging: false });
  });
});

describe('shape & marker registries (plugin surface)', () => {
  const descriptor: ShapeDescriptor = (node, theme, state) => ({
    role: 'node',
    label: String(node.data['label'] ?? node.type),
    children: [
      {
        kind: 'rect',
        x: 0,
        y: 0,
        width: node.size.width,
        height: node.size.height,
        style: { fill: theme.tokens.nodeFill, ...(state.selected && { stroke: 'red' }) },
      },
    ],
  });
  const marker: MarkerSpec = {
    path: [
      { kind: 'M', to: { x: -1, y: -1 } },
      { kind: 'L', to: { x: 0, y: 0 } },
      { kind: 'L', to: { x: -1, y: 1 } },
    ],
    filled: false,
  };

  it('registers typed descriptors and markers through a plugin, reverted on uninstall', () => {
    const editor = createGraph();
    editor.use({
      id: 'shapes-test',
      version: '1.0.0',
      install(ctx) {
        ctx.shapes.register('star', descriptor);
        ctx.markers.register('open-arrow-test', marker);
      },
    });
    expect(editor.registries.shapes.get('star')).toBe(descriptor);
    expect(editor.registries.markers.get('open-arrow-test')).toBe(marker);
    editor.unuse('shapes-test');
    expect(editor.registries.shapes.get('star')).toBeUndefined();
    expect(editor.registries.markers.get('open-arrow-test')).toBeUndefined();
  });
});

describe('port visibility (P7-T03 model surface)', () => {
  it('normalizes and preserves the optional visibility rule', () => {
    const node = createNode({
      ports: [
        { id: 'a', visibility: 'always' },
        { id: 'b' },
      ],
    });
    expect(node.ports[0]?.visibility).toBe('always');
    expect('visibility' in (node.ports[1] ?? {})).toBe(false); // absent = hover, JSON-stable
  });
});

describe('label.editRequested (P7-T04 editing contract)', () => {
  it('emits for existing targets and never touches the model or history', () => {
    const editor = createGraph();
    editor.execute(commands.nodeAdd({ id: 'n1', data: { label: 'Hello' } }));
    editor.execute(commands.nodeAdd({ id: 'n2' }));
    editor.execute(
      commands.edgeAdd({ id: 'e1', source: 'n1', target: 'n2', labels: [{ text: 'x', position: 0.5 }] }),
    );
    const seen: unknown[] = [];
    const changes: unknown[] = [];
    editor.on('label.editRequested', (payload) => seen.push(payload));
    editor.on('graph.change', (payload) => changes.push(payload));

    editor.requestLabelEdit('node', 'n1');
    editor.requestLabelEdit('edge', 'e1', 0);

    expect(seen).toEqual([
      { target: 'node', id: 'n1' },
      { target: 'edge', id: 'e1', labelIndex: 0 },
    ]);
    expect(changes).toEqual([]); // pure event — nothing entered history
  });

  it('throws on unknown targets and out-of-range label indexes', () => {
    const editor = createGraph();
    editor.execute(commands.nodeAdd({ id: 'n1' }));
    editor.execute(commands.nodeAdd({ id: 'n2' }));
    editor.execute(commands.edgeAdd({ id: 'e1', source: 'n1', target: 'n2' }));
    expect(() => editor.requestLabelEdit('node', 'nope')).toThrow(/unknown node/);
    expect(() => editor.requestLabelEdit('edge', 'e1', 3)).toThrow(/no label 3/);
  });
});
