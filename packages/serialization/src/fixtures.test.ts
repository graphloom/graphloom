import { describe, expect, it } from 'vitest';
import { deserialize } from './deserialize.js';
import { V1_0_FIXTURE } from './fixtures/v1-0.js';
import { toEditor } from './hydrate.js';

// PERMANENT TEST (P10-T02 acceptance): a frozen historical-version fixture
// must always load through the pipeline. Never edit fixtures/v1-0.ts once
// frozen, and never remove or weaken this test — when a future format
// version ships, add its own fixtures/v1-x.ts and its own permanent test
// instead (migrations.ts's registry comment has the full checklist).
describe('frozen fixture: v1.0', () => {
  it('deserializes and hydrates into a working editor', () => {
    const doc = deserialize(V1_0_FIXTURE);
    expect(doc.graphloom).toBe('1.0');
    expect(doc.metadata.name).toBe('Migration fixture v1.0');

    const editor = toEditor(doc);
    expect(editor.graph.nodeCount).toBe(3);
    expect(editor.graph.edgeCount).toBe(2);
    expect(editor.graph.getNode('alice')?.data).toEqual({ label: 'Alice' });
    expect(editor.graph.getEdge('alice-bob')?.sourcePort).toBe('out');
    expect(editor.graph.getGroup('team')?.members).toEqual(['alice', 'bob']);
  });
});
