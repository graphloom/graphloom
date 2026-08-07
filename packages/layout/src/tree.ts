import { cluster as d3cluster, hierarchy, tree as d3tree } from 'd3-hierarchy';
import type { Point } from '@graphloom/core';
import type { LayoutEngine, LayoutGraph, LayoutResult } from './contract.js';

/** Growth direction for {@link treeLayout} (spec §Layout engines). */
export type TreeDirection = 'TB' | 'BT' | 'LR' | 'RL';

/** Options for {@link treeLayout}. */
export interface TreeLayoutOptions {
  /** `tidy` (Reingold–Tilford, default) keeps children close to their parent; `cluster` aligns all leaves. */
  readonly kind?: 'tidy' | 'cluster';
  /** Direction the tree grows in. Default `TB`. */
  readonly direction?: TreeDirection;
  /** Minimum spacing between siblings, in graph units. Default 80. */
  readonly nodeSeparation?: number;
  /** Spacing between ranks (depth levels), in graph units. Default 120. */
  readonly rankSeparation?: number;
  /**
   * Explicit root node ids, in the order their subtrees are laid out.
   * Defaults to every node with no incoming edge in the input graph — the
   * standard definition of a root for a forest layout.
   */
  readonly roots?: readonly string[];
}

interface TreeItem {
  readonly id: string;
  children?: TreeItem[];
}

/** Builds a spanning forest from `graph`, dropping edges that would revisit an already-placed node (cycles/DAG fan-in). Never hangs — each node is visited at most once. */
function buildForest(graph: LayoutGraph, roots: readonly string[] | undefined): TreeItem[] {
  const childrenOf = new Map<string, string[]>();
  for (const edge of graph.edges) {
    const list = childrenOf.get(edge.source);
    if (list) list.push(edge.target);
    else childrenOf.set(edge.source, [edge.target]);
  }

  let rootIds = roots;
  if (!rootIds) {
    const hasIncoming = new Set(graph.edges.map((edge) => edge.target));
    rootIds = graph.nodes.map((node) => node.id).filter((id) => !hasIncoming.has(id));
  }
  // Every node has an incoming edge (a full cycle) — pick the first node so
  // every graph still lays out (degrade gracefully, never hang).
  if (rootIds.length === 0 && graph.nodes.length > 0) {
    rootIds = [graph.nodes[0]!.id];
  }

  const visited = new Set<string>();
  const build = (id: string): TreeItem | undefined => {
    if (visited.has(id)) return undefined;
    visited.add(id);
    const kids = (childrenOf.get(id) ?? [])
      .map(build)
      .filter((item): item is TreeItem => item !== undefined);
    return kids.length > 0 ? { id, children: kids } : { id };
  };

  const forest = rootIds.map(build).filter((item): item is TreeItem => item !== undefined);
  // Nodes unreachable from any root (isolated cycles elsewhere in the graph)
  // still need a position — seed one tree per remaining node.
  for (const node of graph.nodes) {
    if (!visited.has(node.id)) {
      const item = build(node.id);
      if (item) forest.push(item);
    }
  }
  return forest;
}

function rotate(x: number, y: number, direction: TreeDirection): Point {
  switch (direction) {
    case 'TB':
      return { x, y };
    case 'BT':
      return { x, y: -y };
    case 'LR':
      return { x: y, y: x };
    case 'RL':
      return { x: -y, y: x };
  }
}

/**
 * Tidy-tree / cluster layout ({@link https://d3js.org/d3-hierarchy d3-hierarchy}).
 * Multiple roots (a forest) are laid out as siblings under a synthetic
 * invisible root, so subtrees never overlap. Non-tree edges (cycles, DAG
 * fan-in) are dropped after the first edge that reaches a node — the layout
 * degrades to the spanning forest instead of hanging or throwing.
 */
export const treeLayout: LayoutEngine<TreeLayoutOptions> = {
  id: 'tree',
  async compute(graph: LayoutGraph, options: TreeLayoutOptions): Promise<LayoutResult> {
    const direction = options.direction ?? 'TB';
    const nodeSeparation = options.nodeSeparation ?? 80;
    const rankSeparation = options.rankSeparation ?? 120;
    const forest = buildForest(graph, options.roots);

    // One synthetic super-root makes d3-hierarchy treat every forest root as
    // a sibling, so subtrees never overlap — the standard forest-via-tree
    // trick. It is never emitted: filtered out by identity below.
    const superRoot: TreeItem = { id: '', children: forest };
    const layout = options.kind === 'cluster' ? d3cluster<TreeItem>() : d3tree<TreeItem>();
    layout.nodeSize([nodeSeparation, rankSeparation]);
    const root = layout(hierarchy(superRoot, (item) => item.children));

    const positions = new Map<string, Point>();
    for (const node of root.descendants()) {
      if (node.data === superRoot) continue;
      positions.set(node.data.id, rotate(node.x, node.y, direction));
    }
    return { positions };
  },
};
