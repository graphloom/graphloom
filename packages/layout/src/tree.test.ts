import { expect, it } from 'vitest';
import type { LayoutContext, LayoutGraph } from './contract.js';
import { treeLayout } from './tree.js';

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

it('places every node exactly once for a simple tree', async () => {
  const graph: LayoutGraph = {
    nodes: [node('root'), node('a'), node('b'), node('c')],
    edges: [edge('e1', 'root', 'a'), edge('e2', 'root', 'b'), edge('e3', 'a', 'c')],
  };

  const { positions } = await treeLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(4);
  for (const id of ['root', 'a', 'b', 'c']) expect(positions.has(id)).toBe(true);
});

it('grows top-to-bottom by default: depth increases y by rankSeparation, x unchanged for a lone child', async () => {
  const graph: LayoutGraph = {
    nodes: [node('root'), node('child')],
    edges: [edge('e', 'root', 'child')],
  };

  const { positions } = await treeLayout.compute(graph, { rankSeparation: 100 }, ctx);
  const root = positions.get('root')!;
  const child = positions.get('child')!;

  expect(child.y - root.y).toBe(100);
  expect(child.x).toBe(root.x);
});

it('rotates for left-to-right: depth increases x instead of y', async () => {
  const graph: LayoutGraph = {
    nodes: [node('root'), node('child')],
    edges: [edge('e', 'root', 'child')],
  };

  const { positions } = await treeLayout.compute(
    graph,
    { direction: 'LR', rankSeparation: 100 },
    ctx,
  );
  const root = positions.get('root')!;
  const child = positions.get('child')!;

  expect(child.x - root.x).toBe(100);
  expect(child.y).toBe(root.y);
});

it('grows bottom-to-top: depth decreases y', async () => {
  const graph: LayoutGraph = {
    nodes: [node('root'), node('child')],
    edges: [edge('e', 'root', 'child')],
  };

  const { positions } = await treeLayout.compute(
    graph,
    { direction: 'BT', rankSeparation: 100 },
    ctx,
  );

  expect(positions.get('child')!.y - positions.get('root')!.y).toBe(-100);
});

it('lays out a forest (multiple roots) without overlapping subtrees', async () => {
  const graph: LayoutGraph = {
    nodes: [node('r1'), node('r2')],
    edges: [],
  };

  const { positions } = await treeLayout.compute(graph, { nodeSeparation: 80 }, ctx);
  const r1 = positions.get('r1')!;
  const r2 = positions.get('r2')!;

  expect(Math.abs(r1.x - r2.x)).toBeGreaterThanOrEqual(80);
});

it('rotates for right-to-left: depth decreases x', async () => {
  const graph: LayoutGraph = {
    nodes: [node('root'), node('child')],
    edges: [edge('e', 'root', 'child')],
  };

  const { positions } = await treeLayout.compute(
    graph,
    { direction: 'RL', rankSeparation: 100 },
    ctx,
  );

  expect(positions.get('child')!.x - positions.get('root')!.x).toBe(-100);
  expect(positions.get('child')!.y).toBe(positions.get('root')!.y);
});

it('still places nodes stranded in a cycle that no detected root can reach', async () => {
  // 'a' is a normal root; 'x'/'y' form their own cycle with no incoming-edge-free node.
  const graph: LayoutGraph = {
    nodes: [node('a'), node('b'), node('x'), node('y')],
    edges: [edge('ab', 'a', 'b'), edge('xy', 'x', 'y'), edge('yx', 'y', 'x')],
  };

  const { positions } = await treeLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(4);
});

it('degrades a full cycle to a spanning forest instead of hanging', async () => {
  const graph: LayoutGraph = {
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('e1', 'a', 'b'), edge('e2', 'b', 'c'), edge('e3', 'c', 'a')],
  };

  const { positions } = await treeLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(3);
});

it('places a fan-in node once, under whichever parent reaches it first', async () => {
  // diamond: a -> b, a -> c, b -> d, c -> d
  const graph: LayoutGraph = {
    nodes: [node('a'), node('b'), node('c'), node('d')],
    edges: [
      edge('ab', 'a', 'b'),
      edge('ac', 'a', 'c'),
      edge('bd', 'b', 'd'),
      edge('cd', 'c', 'd'),
    ],
  };

  const { positions } = await treeLayout.compute(graph, {}, ctx);

  expect(positions.size).toBe(4);
});

it('honors an explicit root list', async () => {
  const graph: LayoutGraph = {
    nodes: [node('a'), node('b'), node('c')],
    edges: [edge('e', 'b', 'c')], // 'a' has no edges — not auto-detected without help
  };

  const { positions } = await treeLayout.compute(graph, { roots: ['a', 'b'] }, ctx);

  expect(positions.size).toBe(3);
});

it('supports the cluster variant (all leaves aligned on the depth axis)', async () => {
  const graph: LayoutGraph = {
    nodes: [node('root'), node('a'), node('b'), node('c')],
    edges: [edge('e1', 'root', 'a'), edge('e2', 'a', 'b'), edge('e3', 'root', 'c')],
  };

  const { positions } = await treeLayout.compute(graph, { kind: 'cluster' }, ctx);

  // leaves 'b' and 'c' both sit on the deepest rank in cluster mode.
  expect(positions.get('b')!.y).toBe(positions.get('c')!.y);
});
