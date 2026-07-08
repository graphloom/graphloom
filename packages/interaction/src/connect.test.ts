import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { SceneGraph, SpatialIndex, ViewportController } from '@graphloom/rendering';
import { beforeEach, describe, expect, it } from 'vitest';
import { canConnect, ConnectController, type ConnectPreview } from './connect.js';

let editor: GraphEditor;
let spatial: SpatialIndex;
let viewport: ViewportController;

const controller = (): ConnectController => new ConnectController(editor, spatial, viewport);

beforeEach(() => {
  editor = createGraph();
  editor.execute(
    commands.nodeAdd({
      id: 'src',
      position: { x: 0, y: 0 },
      size: { width: 100, height: 40 },
      ports: [{ id: 'out', side: 'right' }],
    }),
  );
  editor.execute(
    commands.nodeAdd({
      id: 'dst',
      position: { x: 300, y: 0 },
      size: { width: 100, height: 40 },
      ports: [{ id: 'in', side: 'left' }],
    }),
  );
  spatial = new SpatialIndex(new SceneGraph(editor));
  viewport = new ViewportController({ size: { width: 800, height: 600 } });
});

describe('canConnect', () => {
  it('passes with no validators and reports registered rejections', () => {
    expect(canConnect(editor, { source: 'src', target: 'dst' })).toBe(true);
    editor.registries.validators.set('no-self', (_, edge) =>
      edge.source === edge.target ? 'no self-loops' : true,
    );
    expect(canConnect(editor, { source: 'src', target: 'src' })).toBe('no self-loops');
    expect(canConnect(editor, { source: 'src', target: 'dst' })).toBe(true);
  });

  it('rejects unknown endpoints', () => {
    expect(canConnect(editor, { source: 'src', target: 'ghost' })).toMatch(/unknown target/);
    expect(canConnect(editor, { source: 'ghost', target: 'dst' })).toMatch(/unknown source/);
  });
});

describe('ConnectController', () => {
  it('previews from the source port and commits on a valid snapped target', () => {
    const cc = controller();
    expect(cc.begin('src', 'out', { x: 100, y: 20 })).toBe(true);
    expect(cc.preview?.from).toEqual({ x: 100, y: 20 }); // right port anchor
    cc.move({ x: 305, y: 18 }); // near dst's left port (300, 20)
    expect(cc.preview?.target).toEqual({ nodeId: 'dst', portId: 'in' });
    expect(cc.preview?.to).toEqual({ x: 300, y: 20 }); // magnetically snapped
    expect(cc.preview?.valid).toBe(true);
    cc.end();
    const edge = editor.graph.edges()[0];
    expect(edge).toMatchObject({ source: 'src', sourcePort: 'out', target: 'dst', targetPort: 'in' });
    expect(cc.preview).toBeNull();
  });

  it('drop on empty canvas cancels without committing', () => {
    const cc = controller();
    cc.begin('src', 'out', { x: 100, y: 20 });
    cc.move({ x: 200, y: 200 });
    expect(cc.preview?.target).toBeNull();
    cc.end();
    expect(editor.graph.edgeCount).toBe(0);
  });

  it('invalid target never commits and carries the reason', () => {
    editor.registries.validators.set('no-dst', (_, edge) =>
      edge.target === 'dst' ? 'dst refuses connections' : true,
    );
    const cc = controller();
    cc.begin('src', 'out', { x: 100, y: 20 });
    cc.move({ x: 350, y: 20 }); // over dst
    expect(cc.preview?.valid).toBe(false);
    expect(cc.preview?.reason).toBe('dst refuses connections');
    cc.end();
    expect(editor.graph.edgeCount).toBe(0);
  });

  it('self-loops commit where validators allow', () => {
    const cc = controller();
    cc.begin('src', 'out', { x: 100, y: 20 });
    cc.move({ x: 50, y: 20 }); // back over src itself
    expect(cc.preview?.target?.nodeId).toBe('src');
    expect(cc.preview?.valid).toBe(true);
    cc.end();
    expect(editor.graph.edges()[0]).toMatchObject({ source: 'src', target: 'src' });
  });

  it('snaps to node center when no port is in radius', () => {
    const cc = controller();
    cc.begin('src', undefined, { x: 50, y: 20 });
    cc.move({ x: 349, y: 21 }); // inside dst, far from its left port
    expect(cc.preview?.target).toEqual({ nodeId: 'dst' });
    expect(cc.preview?.to).toEqual({ x: 350, y: 20 }); // dst center
    cc.end();
    const edge = editor.graph.edges()[0];
    expect(edge?.targetPort).toBeUndefined();
  });

  it('cancel clears the preview and hidden sources are rejected', () => {
    const cc = controller();
    const seen: (ConnectPreview | null)[] = [];
    cc.on('connect.preview', ({ preview }) => seen.push(preview));
    cc.begin('src', 'out', { x: 100, y: 20 });
    cc.cancel();
    expect(seen.at(-1)).toBeNull();
    expect(editor.graph.edgeCount).toBe(0);

    editor.execute(commands.nodeUpdate('src', { hidden: true }));
    expect(cc.begin('src', 'out', { x: 100, y: 20 })).toBe(false);
    expect(cc.begin('ghost', undefined, { x: 0, y: 0 })).toBe(false);
  });
});
