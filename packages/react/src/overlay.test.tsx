import { commands, createGraph, type GraphSnapshot } from '@graphloom/core';
import { act, fireEvent, render } from '@testing-library/react';
import { createRef, useEffect, useState } from 'react';
import { beforeEach, describe, expect, it } from 'vitest';
import { Graph, type GraphHandle, type OverlayNodeProps } from './graph.js';

const makeDocument = (): GraphSnapshot => {
  const scratch = createGraph();
  scratch.transact(() => {
    scratch.execute(
      commands.nodeAdd({
        id: 'card-1',
        type: 'card',
        position: { x: 100, y: 100 },
        size: { width: 120, height: 60 },
      }),
    );
    scratch.execute(
      commands.nodeAdd({
        id: 'far-card',
        type: 'card',
        position: { x: 5000, y: 5000 },
        size: { width: 120, height: 60 },
      }),
    );
    scratch.execute(
      commands.nodeAdd({
        id: 'plain',
        position: { x: 300, y: 100 },
        size: { width: 80, height: 40 },
      }),
    );
  });
  return scratch.snapshot();
};

let mounts = 0;

const Card = ({ node }: OverlayNodeProps): ReturnType<typeof Object> => {
  const [count, setCount] = useState(0);
  useEffect(() => {
    mounts++;
  }, []);
  return (
    <button type="button" onClick={() => setCount((c) => c + 1)}>
      {node.id}:{count}
    </button>
  );
};

const setup = (): { ref: React.RefObject<GraphHandle | null>; container: HTMLElement } => {
  const ref = createRef<GraphHandle>();
  const { container } = render(
    <Graph
      ref={ref}
      document={makeDocument()}
      nodeTypes={{ card: Card }}
      // jsdom hosts measure 0×0; seed a real size for culling.
      options={{ mount: { viewport: { size: { width: 800, height: 600 } } } }}
    />,
  );
  return { ref, container };
};

const overlayFor = (container: HTMLElement, id: string): HTMLElement | null =>
  container.querySelector(`[data-node-id="${id}"]`);

describe('Tier-2 overlay nodes (P6-T03, ADR-0003)', () => {
  beforeEach(() => {
    mounts = 0;
  });

  it('stamps components only for visible nodes of a mapped type', () => {
    const { container } = setup();
    const entry = overlayFor(container, 'card-1');
    expect(entry).not.toBeNull();
    expect(entry!.textContent).toBe('card-1:0');
    expect(overlayFor(container, 'plain')).toBeNull(); // no template for its type
    expect(overlayFor(container, 'far-card')).toBeNull(); // virtualized away
    expect(mounts).toBe(1);
  });

  it('positions entries from core viewport math (pixel lock)', () => {
    const { ref, container } = setup();
    const entry = overlayFor(container, 'card-1')!;
    expect(entry.style.transform).toBe('translate(100px, 100px) scale(1)');
    expect(entry.style.width).toBe('120px');
    expect(entry.style.height).toBe('60px');

    act(() => {
      ref.current!.engine!.wheel({ point: { x: 0, y: 0 }, deltaY: -100 }); // zoom in at origin
      ref.current!.host!.viewport.panBy(-30, -10);
    });
    const viewport = ref.current!.host!.viewport;
    const screen = viewport.worldToScreen({ x: 100, y: 100 });
    expect(viewport.viewport.zoom).toBeGreaterThan(1);
    expect(entry.style.transform).toBe(
      `translate(${screen.x}px, ${screen.y}px) scale(${viewport.viewport.zoom})`,
    );
  });

  it('component state survives pan — the instance is not remounted while visible', () => {
    const { ref, container } = setup();
    fireEvent.click(overlayFor(container, 'card-1')!.querySelector('button')!);
    fireEvent.click(overlayFor(container, 'card-1')!.querySelector('button')!);
    expect(overlayFor(container, 'card-1')!.textContent).toBe('card-1:2');

    act(() => {
      ref.current!.host!.viewport.panBy(50, 25); // stays visible
    });
    expect(overlayFor(container, 'card-1')!.textContent).toBe('card-1:2'); // state kept
    expect(mounts).toBe(1); // never remounted
  });

  it('virtualizes: unmounts off-viewport, remounts fresh when scrolled back', () => {
    const { ref, container } = setup();
    fireEvent.click(overlayFor(container, 'card-1')!.querySelector('button')!);
    expect(overlayFor(container, 'card-1')!.textContent).toBe('card-1:1');

    act(() => {
      ref.current!.host!.viewport.panBy(-1000, 0); // push card-1 far off screen
    });
    expect(overlayFor(container, 'card-1')).toBeNull(); // destroyed, not hidden

    act(() => {
      ref.current!.host!.viewport.panBy(1000, 0); // bring it back
    });
    expect(overlayFor(container, 'card-1')!.textContent).toBe('card-1:0'); // fresh instance
    expect(mounts).toBe(2);
  });

  it('mounts a far node once the viewport reaches it', () => {
    const { ref, container } = setup();
    expect(overlayFor(container, 'far-card')).toBeNull();
    act(() => {
      ref.current!.host!.viewport.panBy(-4800, -4800);
    });
    expect(overlayFor(container, 'far-card')).not.toBeNull();
  });

  it('hides hidden nodes even when their type is mapped', () => {
    const { ref, container } = setup();
    act(() => {
      ref.current!.editor!.execute(commands.nodeUpdate('card-1', { hidden: true }));
    });
    expect(overlayFor(container, 'card-1')).toBeNull();
  });
});
