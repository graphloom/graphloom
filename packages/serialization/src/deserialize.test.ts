import { describe, expect, it } from 'vitest';
import { canonicalDocument } from './canonical.js';
import { deserialize } from './deserialize.js';
import { FORMAT_VERSION, SerializationError } from './document.js';

const META = {
  id: 'd',
  name: 'n',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-01T00:00:00.000Z',
};

const node = (id: string, over: Record<string, unknown> = {}): Record<string, unknown> => ({
  id,
  type: 'default',
  position: { x: 0, y: 0 },
  size: { width: 100, height: 40 },
  rotation: 0,
  zIndex: 0,
  locked: false,
  hidden: false,
  ports: [],
  data: {},
  ...over,
});

const doc = (over: Record<string, unknown> = {}): Record<string, unknown> => ({
  graphloom: FORMAT_VERSION,
  generator: 'test',
  metadata: META,
  graph: { nodes: [], edges: [], groups: [] },
  viewport: { x: 0, y: 0, zoom: 1 },
  extensions: {},
  ...over,
});

describe('deserialize — happy path', () => {
  it('accepts JSON text and an already-parsed object equivalently', () => {
    const value = doc({ graph: { nodes: [node('a')], edges: [], groups: [] } });
    expect(deserialize(JSON.stringify(value))).toEqual(deserialize(value));
  });

  it('normalizes key order and array order, defaulting an absent viewport', () => {
    const messy = {
      extensions: { z: 1, a: 2 },
      graph: { groups: [], edges: [], nodes: [node('b'), node('a')] },
      metadata: META,
      generator: 'test',
      graphloom: FORMAT_VERSION,
      // no viewport
    };
    const result = deserialize(messy);
    expect(result).toEqual(
      canonicalDocument({
        graphloom: FORMAT_VERSION,
        generator: 'test',
        metadata: META,
        nodes: [node('a'), node('b')] as never,
        edges: [],
        groups: [],
        viewport: { x: 0, y: 0, zoom: 1 },
        extensions: { z: 1, a: 2 },
      }),
    );
    expect(result.graph.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(Object.keys(result.extensions)).toEqual(['a', 'z']);
  });

  it('preserves an unknown extension entry verbatim', () => {
    const result = deserialize(doc({ extensions: { 'future-plugin': { nested: { k: [1] } } } }));
    expect(result.extensions).toEqual({ 'future-plugin': { nested: { k: [1] } } });
  });

  it('freezes the result deeply', () => {
    const result = deserialize(doc({ graph: { nodes: [node('a')], edges: [], groups: [] } }));
    expect(Object.isFrozen(result)).toBe(true);
    expect(Object.isFrozen(result.graph.nodes[0])).toBe(true);
    expect(Object.isFrozen(result.graph.nodes[0]!.position)).toBe(true);
  });
});

describe('deserialize — rejects malformed input', () => {
  const bad = (input: unknown, path: string | undefined): void => {
    try {
      deserialize(input);
      throw new Error('expected deserialize to throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SerializationError);
      expect((e as SerializationError).path).toBe(path);
    }
  };

  it('non-object input', () => bad(42, '$'));
  it('array input', () => bad([], '$'));
  it('invalid JSON text', () => {
    try {
      deserialize('{ not json');
      throw new Error('expected throw');
    } catch (e) {
      expect(e).toBeInstanceOf(SerializationError);
      expect((e as SerializationError).message).toContain('invalid JSON');
    }
  });
  it('missing graphloom', () => bad(doc({ graphloom: undefined }), 'graphloom'));
  it('unsupported version', () => bad(doc({ graphloom: '2.0' }), 'graphloom'));
  it('unknown envelope key', () => bad(doc({ bogus: 1 }), '$.bogus'));
  it('missing metadata field', () =>
    bad(doc({ metadata: { id: 'd', name: 'n', createdAt: 'x' } }), 'metadata.modifiedAt'));
  it('node missing position', () =>
    bad(doc({ graph: { nodes: [node('a', { position: undefined })], edges: [], groups: [] } }), 'graph.nodes[0].position'));
  it('node position.x wrong type', () =>
    bad(
      doc({ graph: { nodes: [node('a', { position: { x: '0', y: 0 } })], edges: [], groups: [] } }),
      'graph.nodes[0].position.x',
    ));
  it('unknown key on a node', () =>
    bad(doc({ graph: { nodes: [node('a', { extra: 1 })], edges: [], groups: [] } }), 'graph.nodes[0].extra'));
  it('duplicate node id', () =>
    bad(doc({ graph: { nodes: [node('a'), node('a')], edges: [], groups: [] } }), 'graph.nodes[1].id'));
  it('bad port side', () =>
    bad(
      doc({ graph: { nodes: [node('a', { ports: [{ id: 'p', side: 'sideways', offset: 0.5, data: {} }] })], edges: [], groups: [] } }),
      'graph.nodes[0].ports[0].side',
    ));
  it('dangling edge source', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a')],
          edges: [
            { id: 'e', type: 'default', source: 'ghost', target: 'a', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
          ],
          groups: [],
        },
      }),
      'graph.edges[0].source',
    ));
  it('dangling edge target', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a')],
          edges: [
            { id: 'e', type: 'default', source: 'a', target: 'missing', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
          ],
          groups: [],
        },
      }),
      'graph.edges[0].target',
    ));
  it('edge sourcePort not on node', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a'), node('b')],
          edges: [
            { id: 'e', type: 'default', source: 'a', target: 'b', sourcePort: 'nope', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
          ],
          groups: [],
        },
      }),
      'graph.edges[0].sourcePort',
    ));
  it('edge targetPort not on node', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a'), node('b', { ports: [{ id: 'q', side: 'left', offset: 0.5, data: {} }] })],
          edges: [
            { id: 'e', type: 'default', source: 'a', target: 'b', targetPort: 'nope', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
          ],
          groups: [],
        },
      }),
      'graph.edges[0].targetPort',
    ));
  it('duplicate edge id', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a'), node('b')],
          edges: [
            { id: 'e', type: 'default', source: 'a', target: 'b', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
            { id: 'e', type: 'default', source: 'b', target: 'a', routing: 'straight', labels: [], zIndex: 0, hidden: false, data: {} },
          ],
          groups: [],
        },
      }),
      'graph.edges[1].id',
    ));
  it('duplicate group id', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a')],
          edges: [],
          groups: [
            { id: 'g', members: ['a'], collapsed: false, data: {} },
            { id: 'g', members: [], collapsed: false, data: {} },
          ],
        },
      }),
      'graph.groups[1].id',
    ));
  it('group member not a node', () =>
    bad(
      doc({
        graph: {
          nodes: [node('a')],
          edges: [],
          groups: [{ id: 'g', members: ['a', 'ghost'], collapsed: false, data: {} }],
        },
      }),
      'graph.groups[0].members[1]',
    ));
  it('viewport zoom wrong type', () =>
    bad(doc({ viewport: { x: 0, y: 0, zoom: 'big' } }), 'viewport.zoom'));
});
