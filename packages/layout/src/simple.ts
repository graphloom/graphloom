import type { Point } from '@graphloom/core';
import type { LayoutEngine, LayoutGraph } from './contract.js';

/** Options for {@link gridLayout}. */
export interface GridLayoutOptions {
  /** Nodes per row. Default `ceil(sqrt(nodeCount))` (a roughly square grid). */
  readonly columns?: number;
  /** Column spacing, in graph units. Default 160. */
  readonly cellWidth?: number;
  /** Row spacing, in graph units. Default 120. */
  readonly cellHeight?: number;
}

/** Places nodes on a grid, row-major, in input order — deterministic, no reshuffling between runs. */
export const gridLayout: LayoutEngine<GridLayoutOptions> = {
  id: 'grid',
  async compute(graph: LayoutGraph, options: GridLayoutOptions) {
    const columns = options.columns ?? Math.max(1, Math.ceil(Math.sqrt(graph.nodes.length)));
    const cellWidth = options.cellWidth ?? 160;
    const cellHeight = options.cellHeight ?? 120;
    const positions = new Map<string, Point>();
    graph.nodes.forEach((node, i) => {
      positions.set(node.id, {
        x: (i % columns) * cellWidth,
        y: Math.floor(i / columns) * cellHeight,
      });
    });
    return { positions };
  },
};

/** Options for {@link circularLayout}. */
export interface CircularLayoutOptions {
  /** Ring radius, in graph units. Default: sized so neighbors are `spacing` apart along the arc. */
  readonly radius?: number;
  /** Arc spacing used to derive the default radius. Default 100. */
  readonly spacing?: number;
  /** Angle of the first node, in radians. Default `-π/2` (12 o'clock). */
  readonly startAngle?: number;
}

/** Places nodes evenly around a single ring, in input order. */
export const circularLayout: LayoutEngine<CircularLayoutOptions> = {
  id: 'circular',
  async compute(graph: LayoutGraph, options: CircularLayoutOptions) {
    const count = graph.nodes.length;
    const spacing = options.spacing ?? 100;
    const radius = options.radius ?? (count <= 1 ? 0 : (spacing * count) / (2 * Math.PI));
    const startAngle = options.startAngle ?? -Math.PI / 2;
    const positions = new Map<string, Point>();
    graph.nodes.forEach((node, i) => {
      const angle = startAngle + (2 * Math.PI * i) / count;
      positions.set(node.id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
    });
    return { positions };
  },
};

/** Options for {@link radialLayout}. */
export interface RadialLayoutOptions {
  /** Center node id. Defaults to a node with no incoming edge, else the first node. */
  readonly root?: string;
  /** Spacing between consecutive rings, in graph units. Default 120. */
  readonly ringSeparation?: number;
}

/**
 * Places nodes on concentric rings by BFS depth from `root` along directed
 * edges (depth 0 = root, at the center). Nodes unreachable from the root
 * (disconnected components, or every remaining node once a cycle closes back
 * to an already-placed node) get one extra outer ring — every node always
 * gets a position, on a graph of any shape.
 */
export const radialLayout: LayoutEngine<RadialLayoutOptions> = {
  id: 'radial',
  async compute(graph: LayoutGraph, options: RadialLayoutOptions) {
    const ringSeparation = options.ringSeparation ?? 120;
    const childrenOf = new Map<string, string[]>();
    for (const edge of graph.edges) {
      const list = childrenOf.get(edge.source);
      if (list) list.push(edge.target);
      else childrenOf.set(edge.source, [edge.target]);
    }
    const hasIncoming = new Set(graph.edges.map((edge) => edge.target));
    const root = options.root ?? graph.nodes.find((node) => !hasIncoming.has(node.id))?.id ?? graph.nodes[0]?.id;

    const depth = new Map<string, number>();
    if (root !== undefined) {
      depth.set(root, 0);
      const queue = [root];
      while (queue.length > 0) {
        const id = queue.shift()!;
        for (const child of childrenOf.get(id) ?? []) {
          if (depth.has(child)) continue;
          depth.set(child, depth.get(id)! + 1);
          queue.push(child);
        }
      }
    }
    const strandedDepth = Math.max(0, ...depth.values()) + 1;
    const byDepth = new Map<number, string[]>();
    for (const node of graph.nodes) {
      const d = depth.get(node.id) ?? strandedDepth;
      const list = byDepth.get(d);
      if (list) list.push(node.id);
      else byDepth.set(d, [node.id]);
    }

    const positions = new Map<string, Point>();
    for (const [d, ids] of byDepth) {
      if (d === 0) {
        positions.set(ids[0]!, { x: 0, y: 0 });
        continue;
      }
      const radius = d * ringSeparation;
      ids.forEach((id, i) => {
        const angle = (2 * Math.PI * i) / ids.length - Math.PI / 2;
        positions.set(id, { x: radius * Math.cos(angle), y: radius * Math.sin(angle) });
      });
    }
    return { positions };
  },
};
