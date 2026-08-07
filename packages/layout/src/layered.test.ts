import { expect, it } from 'vitest';
import type { LayoutContext, LayoutGraph } from './contract.js';
import { layeredLayout } from './layered.js';

const ctx: LayoutContext = {
  signal: new AbortController().signal,
  reportProgress: () => {},
  reportPreview: () => {},
};

function node(id: string): LayoutGraph['nodes'][number] {
  return { id, position: { x: 0, y: 0 }, size: { width: 100, height: 40 } };
}

function edge(id: string, source: string, target: string): LayoutGraph['edges'][number] {
  return { id, source, target };
}

it('places every node exactly once', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'a', 'b', 'c'].map(node),
    edges: [edge('e1', 'root', 'a'), edge('e2', 'root', 'b'), edge('e3', 'a', 'c')],
  };

  const { positions } = await layeredLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(4);
});

it('is deterministic for a fixed graph', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'a', 'b'].map(node),
    edges: [edge('e1', 'root', 'a'), edge('e2', 'root', 'b')],
  };

  const first = await layeredLayout.compute(graph, {}, ctx);
  const second = await layeredLayout.compute(graph, {}, ctx);

  expect([...first.positions]).toEqual([...second.positions]);
});

it('grows top-to-bottom by default: rank increases y', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'child'].map(node),
    edges: [edge('e', 'root', 'child')],
  };

  const { positions } = await layeredLayout.compute(graph, {}, ctx);

  expect(positions.get('child')!.y).toBeGreaterThan(positions.get('root')!.y);
  expect(positions.get('child')!.x).toBeCloseTo(positions.get('root')!.x);
});

it('rotates for left-to-right: rank increases x instead', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'child'].map(node),
    edges: [edge('e', 'root', 'child')],
  };

  const { positions } = await layeredLayout.compute(graph, { direction: 'LR' }, ctx);

  expect(positions.get('child')!.x).toBeGreaterThan(positions.get('root')!.x);
  expect(positions.get('child')!.y).toBeCloseTo(positions.get('root')!.y);
});

it('spaces same-rank siblings apart', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'a', 'b'].map(node),
    edges: [edge('e1', 'root', 'a'), edge('e2', 'root', 'b')],
  };

  const { positions } = await layeredLayout.compute(graph, {}, ctx);

  expect(positions.get('a')!.x).not.toBeCloseTo(positions.get('b')!.x);
});

it('does not hang or throw on a self-loop', async () => {
  const graph: LayoutGraph = {
    nodes: [node('a'), node('b')],
    edges: [edge('self', 'a', 'a'), edge('e', 'a', 'b')],
  };

  const { positions } = await layeredLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(2);
});

it('handles an empty graph', async () => {
  const { positions } = await layeredLayout.compute({ nodes: [], edges: [] }, {}, ctx);

  expect(positions.size).toBe(0);
});
