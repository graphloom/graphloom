import { expect, it } from 'vitest';
import type { LayoutContext, LayoutGraph } from './contract.js';
import { forceLayout } from './force.js';

function ctx(signal = new AbortController().signal): LayoutContext {
  return { signal, reportProgress: () => {}, reportPreview: () => {} };
}

function node(id: string, x = 0, y = 0): LayoutGraph['nodes'][number] {
  return { id, position: { x, y }, size: { width: 100, height: 40 } };
}

function edge(id: string, source: string, target: string): LayoutGraph['edges'][number] {
  return { id, source, target };
}

it('is deterministic: identical input produces identical output', async () => {
  const graph: LayoutGraph = {
    nodes: [node('a', 0, 0), node('b', 10, 10), node('c', -10, 5)],
    edges: [edge('ab', 'a', 'b'), edge('bc', 'b', 'c')],
  };

  const first = await forceLayout.compute(graph, { iterations: 50 }, ctx());
  const second = await forceLayout.compute(graph, { iterations: 50 }, ctx());

  expect([...first.positions]).toEqual([...second.positions]);
});

it('spreads coincident nodes apart via charge repulsion', async () => {
  const graph: LayoutGraph = {
    nodes: [node('a', 0, 0), node('b', 0, 0)], // same starting center, no link
    edges: [],
  };

  const { positions } = await forceLayout.compute(graph, { iterations: 100 }, ctx());
  const a = positions.get('a')!;
  const b = positions.get('b')!;

  expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThan(1);
});

it('places every node exactly once, including self-loops and empty graphs', async () => {
  const withSelfLoop: LayoutGraph = {
    nodes: [node('a'), node('b')],
    edges: [edge('self', 'a', 'a'), edge('e', 'a', 'b')],
  };
  const { positions } = await forceLayout.compute(withSelfLoop, { iterations: 20 }, ctx());
  expect(positions.size).toBe(2);

  const empty = await forceLayout.compute({ nodes: [], edges: [] }, {}, ctx());
  expect(empty.positions.size).toBe(0);
});

it('stops immediately on a pre-aborted signal, returning the seeded (unmoved) centers', async () => {
  const controller = new AbortController();
  controller.abort();
  const graph: LayoutGraph = { nodes: [node('a', 0, 0)], edges: [] };

  const { positions } = await forceLayout.compute(graph, { iterations: 100 }, ctx(controller.signal));

  // seeded center = position + size/2 (top-left {0,0}, size 100x40)
  expect(positions.get('a')).toEqual({ x: 50, y: 20 });
});

it('reports progress during a normal run', async () => {
  const seen: number[] = [];
  const graph: LayoutGraph = { nodes: [node('a'), node('b')], edges: [edge('e', 'a', 'b')] };

  await forceLayout.compute(graph, { iterations: 50 }, {
    signal: new AbortController().signal,
    reportProgress: (ratio) => seen.push(ratio),
    reportPreview: () => {},
  });

  expect(seen.length).toBeGreaterThan(0);
});

it('streams interim positions for every node during a normal run (live-preview mode)', async () => {
  const seen: Array<ReadonlyMap<string, unknown>> = [];
  const graph: LayoutGraph = { nodes: [node('a'), node('b')], edges: [edge('e', 'a', 'b')] };

  await forceLayout.compute(graph, { iterations: 50 }, {
    signal: new AbortController().signal,
    reportProgress: () => {},
    reportPreview: (positions) => seen.push(positions),
  });

  expect(seen.length).toBeGreaterThan(0);
  expect(seen[0]?.size).toBe(2);
});
