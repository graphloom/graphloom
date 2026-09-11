import { describe, expect, it } from 'vitest';
import { deserialize } from './deserialize.js';
import { SerializationError } from './document.js';
import { serialize, serializeDocument, toDocument } from './serialize.js';
import { toEditor } from './hydrate.js';

const META = {
  id: 'd',
  name: 'n',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

const node = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 'default',
  position: { x: 1, y: 2 },
  size: { width: 100, height: 40 },
  rotation: 0,
  zIndex: 0,
  locked: false,
  hidden: false,
  ports: [],
  data: {},
  ...over,
});

const sampleDoc = deserialize({
  graphloom: '1.0',
  generator: 'test',
  metadata: META,
  graph: {
    nodes: [node('n1', { data: { label: 'A' } }), node('n2')],
    edges: [
      { id: 'e1', type: 'default', source: 'n1', target: 'n2', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
    ],
    groups: [{ id: 'g1', members: ['n1', 'n2'], collapsed: false, label: 'grp', data: {} }],
  },
  viewport: { x: 3, y: 4, zoom: 2 },
  extensions: { plug: { a: 1 } },
});

describe('toEditor', () => {
  it('replays the document into a working editor', () => {
    const editor = toEditor(sampleDoc);
    expect(editor.graph.nodeCount).toBe(2);
    expect(editor.graph.edgeCount).toBe(1);
    expect(editor.graph.getNode('n1')?.data).toEqual({ label: 'A' });
    expect(editor.graph.getNode('n1')?.position).toEqual({ x: 1, y: 2 });
    expect(editor.graph.getEdge('e1')?.target).toBe('n2');
    expect(editor.graph.getGroup('g1')?.members).toEqual(['n1', 'n2']);
    expect(editor.graph.meta).toEqual(META);
  });

  it('round-trips document -> editor -> document byte-identically', () => {
    const extras = {
      viewport: sampleDoc.viewport,
      extensions: sampleDoc.extensions,
      generator: sampleDoc.generator,
    };
    expect(toDocument(toEditor(sampleDoc), extras)).toEqual(sampleDoc);
    expect(serialize(toEditor(sampleDoc), extras)).toBe(serializeDocument(sampleDoc));
  });

  it('rejects a document over the node limit before building anything', () => {
    const big = deserialize({
      graphloom: '1.0',
      generator: 't',
      metadata: META,
      graph: { nodes: [node('a'), node('b'), node('c')], edges: [], groups: [] },
      viewport: { x: 0, y: 0, zoom: 1 },
      extensions: {},
    });
    expect(() => toEditor(big, { limits: { maxNodes: 2 } })).toThrow(SerializationError);
    try {
      toEditor(big, { limits: { maxNodes: 2 } });
    } catch (e) {
      expect((e as SerializationError).path).toBe('graph.nodes');
      expect((e as SerializationError).message).toContain('3 nodes');
    }
  });

  it('rejects a document over the edge limit', () => {
    const d = deserialize({
      graphloom: '1.0',
      generator: 't',
      metadata: META,
      graph: {
        nodes: [node('a'), node('b')],
        edges: [
          { id: 'e1', type: 'default', source: 'a', target: 'b', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
          { id: 'e2', type: 'default', source: 'b', target: 'a', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
        ],
        groups: [],
      },
      viewport: { x: 0, y: 0, zoom: 1 },
      extensions: {},
    });
    expect(() => toEditor(d, { limits: { maxEdges: 1 } })).toThrow(/2 edges/);
  });
});
