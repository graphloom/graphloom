import { commands, createGraph, type GraphSnapshot } from '@graphloom/core';
import { act, render } from '@testing-library/react';
import { createRef, startTransition, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Graph, type GraphHandle } from './graph.js';
import { useGraph, useSelection, useUndoRedo, useViewport } from './hooks.js';

const makeDocument = (): GraphSnapshot => {
  const scratch = createGraph();
  scratch.transact(() => {
    scratch.execute(
      commands.nodeAdd({ id: 'a', position: { x: 100, y: 100 }, size: { width: 80, height: 40 } }),
    );
    scratch.execute(
      commands.nodeAdd({ id: 'b', position: { x: 400, y: 100 }, size: { width: 80, height: 40 } }),
    );
    scratch.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
  });
  return scratch.snapshot();
};

describe('hooks (P6-T01/T02)', () => {
  it('throw outside <Graph>', () => {
    const Bad = (): null => {
      useSelection();
      return null;
    };
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    expect(() => render(<Bad />)).toThrow(/inside a <Graph>/);
    spy.mockRestore();
  });

  it('serve graph content, selection, viewport and undo state', () => {
    const ref = createRef<GraphHandle>();
    const box: Record<string, unknown> = {};
    const Probe = (): null => {
      const graph = useGraph();
      box['ready'] = graph.ready;
      box['nodeIds'] = graph.nodes.map((n) => n.id).sort();
      box['edgeIds'] = graph.edges.map((e) => e.id);
      box['selection'] = useSelection();
      box['viewport'] = useViewport();
      box['undoRedo'] = useUndoRedo();
      return null;
    };
    render(
      <Graph ref={ref} document={makeDocument()}>
        <Probe />
      </Graph>,
    );
    expect(box['ready']).toBe(true);
    expect(box['nodeIds']).toEqual(['a', 'b']);
    expect(box['edgeIds']).toEqual(['ab']);
    expect(box['selection']).toEqual([]);
    expect(box['viewport']).toEqual({ x: 0, y: 0, zoom: 1 });

    act(() => {
      ref.current!.engine!.selection.set(['a']);
      ref.current!.host!.viewport.panBy(10, 20);
      ref.current!.editor!.execute(commands.nodeUpdate('a', { position: { x: 0, y: 0 } }));
    });
    expect(box['selection']).toEqual(['a']);
    expect(box['viewport']).toEqual({ x: 10, y: 20, zoom: 1 });

    const undoRedo = box['undoRedo'] as ReturnType<typeof useUndoRedo>;
    expect(undoRedo.canUndo).toBe(true);
    act(() => (box['undoRedo'] as ReturnType<typeof useUndoRedo>).undo());
    expect((box['undoRedo'] as ReturnType<typeof useUndoRedo>).canUndo).toBe(false);
    expect((box['undoRedo'] as ReturnType<typeof useUndoRedo>).canRedo).toBe(true);
    act(() => (box['undoRedo'] as ReturnType<typeof useUndoRedo>).redo());
    expect((box['undoRedo'] as ReturnType<typeof useUndoRedo>).canRedo).toBe(false);
  });

  it('unrelated-slice updates do not re-render consumers (P6-T02 acceptance)', () => {
    const ref = createRef<GraphHandle>();
    let selectionRenders = 0;
    let viewportRenders = 0;
    const SelectionProbe = (): null => {
      useSelection();
      selectionRenders++;
      return null;
    };
    const ViewportProbe = (): null => {
      useViewport();
      viewportRenders++;
      return null;
    };
    render(
      <Graph ref={ref} document={makeDocument()}>
        <SelectionProbe />
        <ViewportProbe />
      </Graph>,
    );
    const selectionBefore = selectionRenders;
    const viewportBefore = viewportRenders;

    act(() => {
      // Touches the nodes slice and history only.
      ref.current!.editor!.execute(commands.nodeUpdate('a', { position: { x: 5, y: 5 } }));
    });
    expect(selectionRenders).toBe(selectionBefore);
    expect(viewportRenders).toBe(viewportBefore);

    act(() => {
      ref.current!.engine!.selection.set(['b']);
    });
    expect(selectionRenders).toBe(selectionBefore + 1);
    expect(viewportRenders).toBe(viewportBefore);
  });

  it('never tears under startTransition churn (P6-T02 acceptance)', () => {
    const ref = createRef<GraphHandle>();
    const torn: string[] = [];
    let setLane: (n: number) => void = () => {};
    // Reads two slices in one render; a torn frame would show an edge whose
    // endpoints are missing from the concurrently-read nodes slice.
    const Consistency = (): null => {
      const [lane, set] = useState(0);
      setLane = set;
      const { nodes, edges } = useGraph();
      void lane;
      const ids = new Set(nodes.map((n) => n.id));
      for (const edge of edges) {
        if (!ids.has(edge.source) || !ids.has(edge.target)) torn.push(edge.id);
      }
      return null;
    };
    render(
      <Graph ref={ref} document={makeDocument()}>
        <Consistency />
      </Graph>,
    );
    const editor = ref.current!.editor!;
    act(() => {
      for (let i = 0; i < 20; i++) {
        startTransition(() => setLane(i)); // low-priority render in flight …
        editor.transact(() => {
          // … while the store mutates: remove a node (cascades its edge)
          // and add the pair back.
          editor.execute(commands.nodeRemove('a'));
          editor.execute(
            commands.nodeAdd({ id: 'a', position: { x: i, y: 0 }, size: { width: 8, height: 8 } }),
          );
          editor.execute(commands.edgeAdd({ id: 'ab', source: 'a', target: 'b' }));
        });
      }
    });
    expect(torn).toEqual([]);
  });
});
