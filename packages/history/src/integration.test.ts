import { expect, it } from 'vitest';
import { commands, createGraph } from '@graphloom/core';
import { createHistory } from './index.js';

// Phase 2 exit criteria (tracker P2-T10): build a 50-node graph purely
// through commands, mutate it, undo/redo everything, and end bit-identical
// to a recorded snapshot. Everything is deterministic: fixed meta, fixed ids.

it('P2 exit: 50-node command-built graph survives full undo/redo bit-identically', () => {
  const editor = createGraph({
    meta: { id: 'p2-exit', name: 'exit', createdAt: 't0', modifiedAt: 't0' },
  });
  const history = createHistory(editor, { depth: 1000 });
  const initial = JSON.stringify(editor.snapshot());

  // -- build: 50 nodes in 5 transactions, 49 chain edges + 10 cross edges --
  for (let batch = 0; batch < 5; batch++) {
    editor.transact(() => {
      for (let i = 0; i < 10; i++) {
        const n = batch * 10 + i;
        editor.execute(
          commands.nodeAdd({
            id: `n${String(n).padStart(2, '0')}`,
            position: { x: (n % 10) * 120, y: Math.floor(n / 10) * 80 },
            zIndex: n % 3,
            ports: [{ id: 'in', side: 'left' }, { id: 'out' }],
            data: { label: `Node ${n}`, batch },
          }),
        );
      }
    });
  }
  editor.transact(() => {
    for (let n = 1; n < 50; n++) {
      const id = (k: number): string => `n${String(k).padStart(2, '0')}`;
      editor.execute(
        commands.edgeAdd({
          id: `e${n}`,
          source: id(n - 1),
          target: id(n),
          sourcePort: 'out',
          targetPort: 'in',
        }),
      );
    }
  });
  editor.transact(() => {
    for (let k = 0; k < 10; k++) {
      editor.execute(
        commands.edgeAdd({
          id: `x${k}`,
          source: `n${String(k * 5).padStart(2, '0')}`,
          target: `n${String(49 - k).padStart(2, '0')}`,
          routing: 'orthogonal',
        }),
      );
    }
  });
  editor.execute(commands.groupCreate({ id: 'g-even', members: ['n00', 'n02', 'n04'] }));
  editor.execute(commands.groupCreate({ id: 'g-tail', members: ['n48', 'n49'] }));

  // -- mutate: moves, property edits, rewires, group ops, removals, z-order --
  editor.transact(() => {
    for (let n = 0; n < 50; n += 2) {
      editor.execute(
        commands.nodeUpdate(`n${String(n).padStart(2, '0')}`, {
          position: { x: n * 7, y: n * 3 },
        }),
      );
    }
  });
  editor.execute(commands.nodeUpdate('n01', { style: 'accent', data: { label: 'renamed' } }));
  editor.execute(commands.nodeUpdate('n01', { style: null }));
  editor.execute(commands.edgeUpdate('x0', { target: 'n25', labels: [{ text: 'rewired', position: 0.5 }] }));
  editor.execute(commands.groupAdd('g-even', ['n06']));
  editor.execute(commands.groupRemove('g-even', ['n02']));
  editor.execute(commands.groupCollapse('g-tail'));
  editor.execute(commands.zReorder('n07', 99));
  editor.execute(commands.zReorder('e7', -1));
  editor.execute(commands.nodeRemove('n33')); // cascades e33, e34
  editor.execute(commands.groupDissolve('g-even'));
  editor.execute(commands.graphUpdate({ name: 'exit-final', modifiedAt: 't1' }));

  const final = JSON.stringify(editor.snapshot());
  expect(final).toMatchSnapshot('p2-exit-final-state');

  // -- undo everything: back to the pristine empty document --
  let undos = 0;
  while (history.undo()) undos++;
  expect(undos).toBeGreaterThan(15);
  expect(JSON.stringify(editor.snapshot())).toBe(initial);

  // -- redo everything: bit-identical to the recorded final state --
  let redos = 0;
  while (history.redo()) redos++;
  expect(redos).toBe(undos);
  expect(JSON.stringify(editor.snapshot())).toBe(final);

  // and the whole cycle again, for good measure (stacks stay coherent)
  while (history.undo()) undos--;
  expect(JSON.stringify(editor.snapshot())).toBe(initial);
});
