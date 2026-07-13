import { commands, createGraph, type GraphSnapshot } from '@graphloom/core';
import { act, render } from '@testing-library/react';
import { StrictMode, createRef } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { Graph, type GraphHandle } from './graph.js';

const makeDocument = (ids: readonly string[]): GraphSnapshot => {
  const scratch = createGraph();
  scratch.transact(() => {
    for (const [i, id] of ids.entries()) {
      scratch.execute(
        commands.nodeAdd({
          id,
          position: { x: 100 * (i + 1), y: 100 },
          size: { width: 80, height: 40 },
        }),
      );
    }
  });
  return scratch.snapshot();
};

describe('<Graph> lifecycle (P6-T01)', () => {
  it('StrictMode mount/unmount/mount leaves exactly one live editor', () => {
    const ref = createRef<GraphHandle>();
    const { container, unmount } = render(
      <StrictMode>
        <Graph ref={ref} />
      </StrictMode>,
    );
    // StrictMode ran create→destroy→create; a leaked wiring would show as a
    // second renderer mount inside the canvas element.
    expect(container.querySelectorAll('svg')).toHaveLength(1);
    expect(ref.current?.editor).not.toBeNull();

    const editor = ref.current!.editor!;
    act(() => {
      editor.execute(
        commands.nodeAdd({ id: 'n', position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
      );
    });
    expect([...editor.graph.nodes()]).toHaveLength(1);

    unmount();
    expect(container.querySelectorAll('svg')).toHaveLength(0); // torn down
    expect(ref.current).toBeNull();

    const second = render(
      <StrictMode>
        <Graph />
      </StrictMode>,
    );
    expect(second.container.querySelectorAll('svg')).toHaveLength(1);
  });

  it('exposes every wired service through the ref handle', () => {
    const ref = createRef<GraphHandle>();
    render(<Graph ref={ref} />);
    const handle = ref.current!;
    expect(handle.editor).not.toBeNull();
    expect(handle.history).not.toBeNull();
    expect(handle.clipboard).not.toBeNull();
    expect(handle.engine).not.toBeNull();
    expect(handle.host).not.toBeNull();
  });

  it('loads the document, reloads on prop change, and clears history', () => {
    const ref = createRef<GraphHandle>();
    const { rerender } = render(
      <StrictMode>
        <Graph ref={ref} document={makeDocument(['a', 'b'])} />
      </StrictMode>,
    );
    const ids = (): string[] =>
      [...ref.current!.editor!.graph.nodes()].map((n) => n.id).sort();
    expect(ids()).toEqual(['a', 'b']);
    expect(ref.current!.history!.canUndo).toBe(false); // loading is not user work

    rerender(
      <StrictMode>
        <Graph ref={ref} document={makeDocument(['c'])} />
      </StrictMode>,
    );
    expect(ids()).toEqual(['c']); // replaced, not merged
    expect(ref.current!.history!.canUndo).toBe(false);
  });

  it('forwards editor events to the latest callback props', () => {
    const first = vi.fn();
    const second = vi.fn();
    const ref = createRef<GraphHandle>();
    const { rerender } = render(<Graph ref={ref} onNodeCreated={first} />);
    const add = (id: string): void => {
      act(() => {
        ref.current!.editor!.execute(
          commands.nodeAdd({ id, position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
        );
      });
    };
    add('a');
    expect(first).toHaveBeenCalledTimes(1);

    rerender(<Graph ref={ref} onNodeCreated={second} />); // no re-wiring
    add('b');
    expect(first).toHaveBeenCalledTimes(1); // stale callback not called again
    expect(second).toHaveBeenCalledTimes(1);
  });

  it('forwards viewport changes from the controller', () => {
    const onViewportChanged = vi.fn();
    const ref = createRef<GraphHandle>();
    render(<Graph ref={ref} onViewportChanged={onViewportChanged} />);
    act(() => {
      ref.current!.host!.viewport.panBy(10, 20);
    });
    expect(onViewportChanged).toHaveBeenCalledWith(
      expect.objectContaining({ viewport: { x: 10, y: 20, zoom: 1 } }),
    );
  });

  it('applies limits at creation (ADR-0007 at the command boundary)', () => {
    const onLimitExceeded = vi.fn();
    const ref = createRef<GraphHandle>();
    render(<Graph ref={ref} limits={{ maxNodes: 1 }} onLimitExceeded={onLimitExceeded} />);
    const add = (id: string): void => {
      ref.current!.editor!.execute(
        commands.nodeAdd({ id, position: { x: 0, y: 0 }, size: { width: 10, height: 10 } }),
      );
    };
    act(() => {
      add('a');
      expect(() => add('b')).toThrow();
    });
    expect([...ref.current!.editor!.graph.nodes()]).toHaveLength(1);
    expect(onLimitExceeded).toHaveBeenCalled();
  });
});
