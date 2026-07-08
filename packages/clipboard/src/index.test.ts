import {
  commands,
  createGraph,
  LimitExceededError,
  type GraphEditor,
} from '@graphloom/core';
import { createHistory } from '@graphloom/history';
import { beforeEach, describe, expect, it } from 'vitest';
import { createClipboard, parseClipboardPayload, PACKAGE_NAME } from './index.js';

let editor: GraphEditor;

beforeEach(() => {
  editor = createGraph();
  editor.execute(
    commands.nodeAdd({
      id: 'a',
      position: { x: 10, y: 10 },
      ports: [{ id: 'out', side: 'right' }],
      data: { label: 'A' },
    }),
  );
  editor.execute(commands.nodeAdd({ id: 'b', position: { x: 200, y: 10 } }));
  editor.execute(commands.nodeAdd({ id: 'c', position: { x: 400, y: 10 } }));
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b', sourcePort: 'out' }));
  editor.execute(commands.edgeAdd({ id: 'bc', source: 'b', target: 'c' }));
});

it('exports its package name', () => {
  expect(PACKAGE_NAME).toBe('@graphloom/clipboard');
});

describe('copy', () => {
  it('captures nodes plus internal edges; boundary edges are dropped', () => {
    const clipboard = createClipboard(editor);
    const payload = clipboard.copy(['a', 'b'])!;
    expect(payload.nodes.map((n) => n.id)).toEqual(['a', 'b']);
    expect(payload.edges.map((e) => e.id)).toEqual(['ab']); // bc reaches outside
    expect(clipboard.current).toBe(payload);
  });

  it('ignores edge/unknown ids and returns null when nothing is copyable', () => {
    const clipboard = createClipboard(editor);
    clipboard.copy(['a']);
    expect(clipboard.copy(['ab', 'ghost'])).toBeNull();
    expect(clipboard.current?.nodes.map((n) => n.id)).toEqual(['a']); // kept
  });

  it('payload is a snapshot: later model changes do not leak in', () => {
    const clipboard = createClipboard(editor);
    const payload = clipboard.copy(['a'])!;
    editor.execute(commands.nodeUpdate('a', { position: { x: 999, y: 999 } }));
    expect(payload.nodes[0]?.position).toEqual({ x: 10, y: 10 });
  });
});

describe('paste', () => {
  it('creates fresh ids, remaps edges (ports intact), and undoes as one entry', () => {
    const history = createHistory(editor);
    const clipboard = createClipboard(editor);
    clipboard.copy(['a', 'b']);
    const before = editor.graph.nodeCount;
    const newIds = clipboard.paste();
    expect(newIds).toHaveLength(3); // 2 nodes + 1 edge
    expect(editor.graph.nodeCount).toBe(before + 2);
    const pastedEdge = editor.graph.edges().find((e) => e.id === newIds[2])!;
    expect(pastedEdge.source).toBe(newIds[0]);
    expect(pastedEdge.target).toBe(newIds[1]);
    expect(pastedEdge.sourcePort).toBe('out');
    expect(editor.graph.getNode(newIds[0]!)?.data).toEqual({ label: 'A' });
    history.undo(); // one transaction for N nodes + M edges
    expect(editor.graph.nodeCount).toBe(before);
    expect(history.canUndo).toBe(false); // the paste was the only entry — one undo cleared it
  });

  it('offsets by the paste offset and cascades on repeated paste', () => {
    const clipboard = createClipboard(editor, { pasteOffset: { x: 20, y: 20 } });
    clipboard.copy(['a']);
    const first = clipboard.paste();
    const second = clipboard.paste();
    expect(editor.graph.getNode(first[0]!)?.position).toEqual({ x: 30, y: 30 });
    expect(editor.graph.getNode(second[0]!)?.position).toEqual({ x: 50, y: 50 });
    // Fresh copy resets the cascade.
    clipboard.copy(['a']);
    const third = clipboard.paste();
    expect(editor.graph.getNode(third[0]!)?.position).toEqual({ x: 30, y: 30 });
  });

  it('empty clipboard pastes nothing', () => {
    const clipboard = createClipboard(editor);
    expect(clipboard.paste()).toEqual([]);
  });

  it('paste exceeding graph limits rejects atomically (ADR-0007)', () => {
    const small = createGraph({ limits: { maxNodes: 4 } });
    for (const id of ['a', 'b', 'c']) {
      small.execute(commands.nodeAdd({ id }));
    }
    small.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
    const clipboard = createClipboard(small);
    clipboard.copy(['a', 'b']); // 2 nodes: 3 + 2 > 4
    expect(() => clipboard.paste()).toThrow(LimitExceededError);
    expect(small.graph.nodeCount).toBe(3); // nothing half-applied
    expect(small.graph.edgeCount).toBe(1);
    // A failed paste must not advance the cascade: make room, paste again,
    // and the copy lands at the first-generation offset.
    small.execute(commands.nodeRemove('c'));
    const ids = clipboard.paste();
    const aCopy = small.graph.getNode(ids[0]!)!;
    expect(aCopy.position).toEqual({ x: 20, y: 20 }); // a was at 0,0 in `small`
  });
});

describe('duplicate', () => {
  it('duplicates without touching the clipboard', () => {
    const clipboard = createClipboard(editor);
    clipboard.copy(['c']);
    const ids = clipboard.duplicate(['a', 'b']);
    expect(ids).toHaveLength(3);
    expect(clipboard.current?.nodes.map((n) => n.id)).toEqual(['c']);
    expect(clipboard.duplicate(['ghost'])).toEqual([]);
  });
});

describe('parseClipboardPayload (cross-instance paste)', () => {
  it('round-trips through JSON text into another editor', () => {
    const clipboard = createClipboard(editor);
    const text = JSON.stringify(clipboard.copy(['a', 'b']));
    const other = createGraph();
    const otherClipboard = createClipboard(other);
    const payload = parseClipboardPayload(text)!;
    expect(payload).not.toBeNull();
    const ids = otherClipboard.paste(payload);
    expect(other.graph.nodeCount).toBe(2);
    expect(other.graph.edgeCount).toBe(1);
    expect(ids).toHaveLength(3);
  });

  it('rejects foreign or malformed text without throwing', () => {
    expect(parseClipboardPayload('not json')).toBeNull();
    expect(parseClipboardPayload('{"kind":"other"}')).toBeNull();
    expect(parseClipboardPayload('{"kind":"graphloom/subgraph","version":2}')).toBeNull();
    expect(
      parseClipboardPayload('{"kind":"graphloom/subgraph","version":1,"nodes":[],"edges":{}}'),
    ).toBeNull();
  });
});
