import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { deserialize } from './deserialize.js';
import { DEFAULT_GENERATOR, FORMAT_VERSION } from './document.js';
import { serialize, serializeDocument, toDocument } from './serialize.js';

const META = {
  id: 'doc-1',
  name: 'Sample',
  createdAt: '2026-01-01T00:00:00.000Z',
  modifiedAt: '2026-01-02T00:00:00.000Z',
};

const sampleEditor = (): GraphEditor => {
  const ed = createGraph({ meta: META });
  ed.transact(() => {
    // added out of id order on purpose — the document must sort them
    ed.execute(
      commands.nodeAdd({
        id: 'n2',
        position: { x: 10, y: 20 },
        ports: [{ id: 'q', side: 'left' }],
        data: { label: 'B' },
      }),
    );
    ed.execute(
      commands.nodeAdd({
        id: 'n1',
        position: { x: 0, y: 0 },
        style: 'accent',
        ports: [{ id: 'p', side: 'right', visibility: 'always' }],
        data: { label: 'A' },
      }),
    );
    ed.execute(
      commands.edgeAdd({
        id: 'e1',
        source: 'n1',
        target: 'n2',
        sourcePort: 'p',
        targetPort: 'q',
        style: 'dashed',
        labels: [{ text: 'x', position: 0.5 }],
      }),
    );
    ed.execute(commands.groupCreate({ id: 'g1', members: ['n2', 'n1'], label: 'grp' }));
  });
  return ed;
};

describe('toDocument', () => {
  it('builds the ADR-0004 envelope from editor state', () => {
    const doc = toDocument(sampleEditor());
    expect(doc.graphloom).toBe(FORMAT_VERSION);
    expect(doc.generator).toBe(DEFAULT_GENERATOR);
    expect(doc.metadata).toEqual(META);
    expect(doc.graph.nodes.map((n) => n.id)).toEqual(['n1', 'n2']);
    expect(doc.graph.edges.map((e) => e.id)).toEqual(['e1']);
    expect(doc.graph.groups[0]?.members).toEqual(['n1', 'n2']);
    expect(doc.viewport).toEqual({ x: 0, y: 0, zoom: 1 });
    expect(doc.extensions).toEqual({});
  });

  it('takes producer-supplied viewport, extensions and generator', () => {
    const doc = toDocument(sampleEditor(), {
      viewport: { x: -5, y: 7, zoom: 2 },
      extensions: { 'my-plugin': { count: 3 } },
      generator: 'my-app@1.2.3',
    });
    expect(doc.viewport).toEqual({ x: -5, y: 7, zoom: 2 });
    expect(doc.extensions).toEqual({ 'my-plugin': { count: 3 } });
    expect(doc.generator).toBe('my-app@1.2.3');
  });

  it('keeps a present optional field and omits an absent one', () => {
    const doc = toDocument(sampleEditor());
    expect(doc.graph.nodes[0]!.style).toBe('accent'); // n1
    expect('style' in doc.graph.nodes[1]!).toBe(false); // n2
  });
});

describe('serialize', () => {
  it('produces canonical key order and a trailing newline', () => {
    const text = serialize(sampleEditor());
    expect(text.endsWith('\n')).toBe(true);
    expect(Object.keys(JSON.parse(text))).toEqual([
      'graphloom',
      'generator',
      'metadata',
      'graph',
      'viewport',
      'extensions',
    ]);
  });

  it('round-trips byte-identically through deserialize', () => {
    const text = serialize(sampleEditor(), { extensions: { plug: { a: [1, 2] } } });
    expect(serializeDocument(deserialize(text))).toBe(text);
  });

  it('is idempotent — a second round-trip changes nothing', () => {
    const once = serialize(sampleEditor());
    const twice = serializeDocument(deserialize(serializeDocument(deserialize(once))));
    expect(twice).toBe(once);
  });
});
