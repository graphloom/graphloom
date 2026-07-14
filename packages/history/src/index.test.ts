import { expect, it } from 'vitest';
import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { createHistory, type History } from './index.js';

const meta = { id: 'doc', name: 'test', createdAt: 't0', modifiedAt: 't0' };

function setup(depth?: number): { editor: GraphEditor; history: History } {
  const editor = createGraph({ meta });
  const history = createHistory(editor, depth === undefined ? {} : { depth });
  return { editor, history };
}

it('undoes and redoes single commands', () => {
  const { editor, history } = setup();
  const empty = editor.snapshot();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  const one = editor.snapshot();
  expect(history.canUndo).toBe(true);
  expect(history.canRedo).toBe(false);
  expect(history.undo()).toBe(true);
  expect(editor.snapshot()).toEqual(empty);
  expect(history.canRedo).toBe(true);
  expect(history.redo()).toBe(true);
  expect(editor.snapshot()).toEqual(one);
  expect(history.undo()).toBe(true);
  expect(history.undo()).toBe(false); // nothing left
  expect(history.redo()).toBe(true);
  expect(history.redo()).toBe(false);
});

it('one transaction = one history entry (ADR-0001)', () => {
  const { editor, history } = setup();
  const empty = editor.snapshot();
  editor.transact(() => {
    editor.execute(commands.nodeAdd({ id: 'a' }));
    editor.execute(commands.nodeAdd({ id: 'b' }));
    editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
  });
  expect(history.undo()).toBe(true);
  expect(editor.snapshot()).toEqual(empty);
  expect(history.undo()).toBe(false);
});

it('clears the redo stack on a new user command (P2-T06 acceptance)', () => {
  const { editor, history } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  history.undo();
  expect(history.canRedo).toBe(true);
  editor.execute(commands.nodeAdd({ id: 'c' })); // divergent edit
  expect(history.canRedo).toBe(false);
  expect(history.redo()).toBe(false);
  expect(editor.graph.getNode('c')).toBeDefined();
  expect(editor.graph.getNode('b')).toBeUndefined();
});

it('evicts the oldest entry beyond the configured depth without corruption', () => {
  const { editor, history } = setup(2);
  for (const id of ['a', 'b', 'c']) editor.execute(commands.nodeAdd({ id }));
  expect(history.undo()).toBe(true);
  expect(history.undo()).toBe(true);
  expect(history.undo()).toBe(false); // 'a' was evicted
  expect(editor.graph.nodeCount).toBe(1);
  expect(editor.graph.getNode('a')).toBeDefined();
  expect(history.redo()).toBe(true);
  expect(history.redo()).toBe(true);
  expect(editor.graph.nodeCount).toBe(3);
});

it('coalesces consecutive commits sharing a coalesceKey (label-typing pattern)', () => {
  const { editor, history } = setup();
  editor.execute(commands.nodeAdd({ id: 'a', data: { label: '' } }));
  for (const label of ['h', 'he', 'hel', 'hello']) {
    editor.execute(commands.nodeUpdate('a', { data: { label } }), {
      coalesceKey: 'label:a',
    });
  }
  expect(editor.graph.getNode('a')!.data['label']).toBe('hello');
  history.undo(); // one undo reverts the whole typing burst
  expect(editor.graph.getNode('a')!.data['label']).toBe('');
  history.redo();
  expect(editor.graph.getNode('a')!.data['label']).toBe('hello');
});

it('a different key, a keyless commit, or a pending redo stops coalescing', () => {
  const { editor, history } = setup();
  editor.execute(commands.nodeAdd({ id: 'a', data: { n: 0 } }));
  editor.execute(commands.nodeUpdate('a', { data: { n: 1 } }), { coalesceKey: 'k1' });
  editor.execute(commands.nodeUpdate('a', { data: { n: 2 } }), { coalesceKey: 'k2' });
  history.undo();
  expect(editor.graph.getNode('a')!.data['n']).toBe(1); // k2 was its own entry
  // with a redo pending, a same-key commit must not merge into the undone entry
  editor.execute(commands.nodeUpdate('a', { data: { n: 3 } }), { coalesceKey: 'k1' });
  history.undo();
  expect(editor.graph.getNode('a')!.data['n']).toBe(1);
});

it('emits history.changed with canUndo/canRedo signals', () => {
  const { editor, history } = setup();
  const signals: Array<{ canUndo: boolean; canRedo: boolean }> = [];
  history.on('history.changed', (s) => signals.push(s));
  editor.execute(commands.nodeAdd({ id: 'a' }));
  history.undo();
  history.redo();
  history.clear();
  expect(signals).toEqual([
    { canUndo: true, canRedo: false },
    { canUndo: false, canRedo: true },
    { canUndo: true, canRedo: false },
    { canUndo: false, canRedo: false },
  ]);
});

it('clear() empties both stacks (clear-on-load semantics)', () => {
  const { editor, history } = setup();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  editor.execute(commands.nodeAdd({ id: 'b' }));
  history.undo();
  history.clear();
  expect(history.canUndo).toBe(false);
  expect(history.canRedo).toBe(false);
});

it('dispose() stops recording', () => {
  const { editor, history } = setup();
  history.dispose();
  editor.execute(commands.nodeAdd({ id: 'a' }));
  expect(history.canUndo).toBe(false);
});

it('undo/redo round-trips over a random-ish command sequence (P2-T06 fuzz)', () => {
  const { editor, history } = setup();
  const snapshots = [editor.snapshot()];
  // deterministic mixed workload: adds, updates, removes, groups, transactions
  for (let i = 0; i < 40; i++) {
    switch (i % 5) {
      case 0:
        editor.execute(commands.nodeAdd({ id: `n${i}`, data: { i } }));
        break;
      case 1:
        editor.execute(commands.nodeUpdate(`n${i - 1}`, { position: { x: i, y: -i } }));
        break;
      case 2:
        editor.transact(() => {
          editor.execute(commands.nodeAdd({ id: `n${i}` }));
          editor.execute(commands.edgeAdd({ id: `e${i}`, source: `n${i}`, target: `n${i - 2}` }));
        });
        break;
      case 3:
        editor.execute(commands.groupCreate({ id: `g${i}`, members: [`n${i - 1}`, `n${i - 3}`] }));
        break;
      default:
        editor.execute(commands.nodeRemove(`n${i - 2}`));
        break;
    }
    snapshots.push(editor.snapshot());
  }
  for (let i = snapshots.length - 1; i > 0; i--) {
    expect(editor.snapshot()).toEqual(snapshots[i]);
    expect(history.undo()).toBe(true);
    expect(editor.snapshot()).toEqual(snapshots[i - 1]);
  }
  expect(history.undo()).toBe(false);
  for (let i = 1; i < snapshots.length; i++) {
    expect(history.redo()).toBe(true);
    expect(editor.snapshot()).toEqual(snapshots[i]);
  }
  expect(history.redo()).toBe(false);
});

it('a label edit is one coalesced history entry (P7-T04 acceptance)', () => {
  const { editor, history } = setup();
  editor.execute(commands.nodeAdd({ id: 'n', data: { label: 'Old' } }));

  // The P7-T04 editing contract: the core only raises the event; the host
  // renders an input and commits keystrokes with a shared coalesceKey.
  const requests: unknown[] = [];
  editor.on('label.editRequested', (payload) => requests.push(payload));
  editor.requestLabelEdit('node', 'n');
  expect(requests).toEqual([{ target: 'node', id: 'n' }]);

  for (const text of ['N', 'Ne', 'New']) {
    editor.execute(commands.nodeUpdate('n', { data: { label: text } }), {
      coalesceKey: 'label-edit:n',
    });
  }
  expect(editor.graph.getNode('n')?.data['label']).toBe('New');

  // One undo restores the pre-edit label: the whole edit was one entry.
  expect(history.undo()).toBe(true);
  expect(editor.graph.getNode('n')?.data['label']).toBe('Old');
  expect(history.redo()).toBe(true);
  expect(editor.graph.getNode('n')?.data['label']).toBe('New');
});
