import { expect, it } from 'vitest';
import type { LayoutContext, LayoutGraph } from './contract.js';
import { circularLayout, gridLayout, radialLayout } from './simple.js';

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

// ---- grid -------------------------------------------------------------

it('grid: places nodes row-major with the given column count', async () => {
  const graph: LayoutGraph = { nodes: ['a', 'b', 'c', 'd'].map(node), edges: [] };

  const { positions } = await gridLayout.compute(graph, { columns: 2, cellWidth: 10, cellHeight: 20 }, ctx);

  expect(positions.get('a')).toEqual({ x: 0, y: 0 });
  expect(positions.get('b')).toEqual({ x: 10, y: 0 });
  expect(positions.get('c')).toEqual({ x: 0, y: 20 });
  expect(positions.get('d')).toEqual({ x: 10, y: 20 });
});

it('grid: is deterministic across repeated runs', async () => {
  const graph: LayoutGraph = { nodes: ['a', 'b', 'c'].map(node), edges: [] };

  const first = await gridLayout.compute(graph, {}, ctx);
  const second = await gridLayout.compute(graph, {}, ctx);

  expect([...first.positions]).toEqual([...second.positions]);
});

// ---- circular -----------------------------------------------------------

it('circular: places every node on the ring at the requested radius', async () => {
  const graph: LayoutGraph = { nodes: ['a', 'b', 'c', 'd'].map(node), edges: [] };

  const { positions } = await circularLayout.compute(graph, { radius: 50 }, ctx);

  for (const p of positions.values()) {
    expect(Math.hypot(p.x, p.y)).toBeCloseTo(50);
  }
});

it('circular: puts a single node at the center (radius 0)', async () => {
  const graph: LayoutGraph = { nodes: [node('a')], edges: [] };

  const { positions } = await circularLayout.compute(graph, {}, ctx);

  expect(positions.get('a')?.x).toBeCloseTo(0);
  expect(positions.get('a')?.y).toBeCloseTo(0);
});

// ---- radial -------------------------------------------------------------

it('radial: centers the root and rings its BFS children by depth', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'a', 'b', 'c'].map(node),
    edges: [edge('e1', 'root', 'a'), edge('e2', 'root', 'b'), edge('e3', 'a', 'c')],
  };

  const { positions } = await radialLayout.compute(graph, { ringSeparation: 100 }, ctx);

  expect(positions.get('root')).toEqual({ x: 0, y: 0 });
  expect(Math.hypot(positions.get('a')!.x, positions.get('a')!.y)).toBeCloseTo(100);
  expect(Math.hypot(positions.get('b')!.x, positions.get('b')!.y)).toBeCloseTo(100);
  expect(Math.hypot(positions.get('c')!.x, positions.get('c')!.y)).toBeCloseTo(200);
});

it('radial: places nodes disconnected from the root on an outer ring instead of dropping them', async () => {
  const graph: LayoutGraph = {
    nodes: ['root', 'a', 'stray'].map(node),
    edges: [edge('e1', 'root', 'a')],
  };

  const { positions } = await radialLayout.compute(graph, { ringSeparation: 100 }, ctx);

  expect(positions.size).toBe(3);
  expect(Math.hypot(positions.get('stray')!.x, positions.get('stray')!.y)).toBeCloseTo(200);
});

it('radial: honors an explicit root', async () => {
  const graph: LayoutGraph = {
    nodes: ['a', 'b'].map(node),
    edges: [edge('e', 'b', 'a')], // 'a' has an incoming edge, so auto-detection would pick 'b'
  };

  const { positions } = await radialLayout.compute(graph, { root: 'a', ringSeparation: 100 }, ctx);

  expect(positions.get('a')).toEqual({ x: 0, y: 0 });
});

it('radial: never hangs on a full cycle — falls back to the first node as root', async () => {
  const graph: LayoutGraph = {
    nodes: ['a', 'b', 'c'].map(node),
    edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')],
  };

  const { positions } = await radialLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(3);
});

it('radial: an empty graph produces no positions', async () => {
  const graph: LayoutGraph = { nodes: [], edges: [] };

  const { positions } = await radialLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(0);
});
