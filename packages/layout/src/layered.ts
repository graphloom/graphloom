import {
  Graph,
  layout as dagreLayout,
  type EdgeLabel,
  type GraphLabel,
  type NodeLabel,
} from '@dagrejs/dagre';
import type { Point } from '@graphloom/core';
import type { LayoutEngine, LayoutGraph } from './contract.js';

/** Direction the ranks flow in — matches dagre's own `rankdir` values. */
export type LayeredDirection = 'TB' | 'BT' | 'LR' | 'RL';

/** Options for {@link layeredLayout}. */
export interface LayeredLayoutOptions {
  /** Direction the ranks flow in. Default `TB`. */
  readonly direction?: LayeredDirection;
  /** Minimum spacing between nodes in the same rank. Default 50. */
  readonly nodeSeparation?: number;
  /** Spacing between ranks. Default 80. */
  readonly rankSeparation?: number;
  /** Minimum spacing between edges in the same rank. Default 20. */
  readonly edgeSeparation?: number;
}

/**
 * Sugiyama-style layered/hierarchical layout via
 * {@link https://github.com/dagrejs/dagre @dagrejs/dagre} (MIT — ADR-0006's
 * D3 ban doesn't apply, dagre isn't a d3 package). Deterministic for a fixed
 * graph: dagre's ranking/ordering/positioning passes have no randomness.
 * Self-loop edges are excluded from ranking (they'd need dagre's separate
 * loop-decoration output, which this contract doesn't carry) but the node
 * itself is still positioned normally by its other edges.
 *
 * dagre is lightly maintained (tracker risk register) — isolated behind the
 * {@link LayoutEngine} contract like every other engine, so it can be
 * replaced without touching callers.
 */
export const layeredLayout: LayoutEngine<LayeredLayoutOptions> = {
  id: 'layered',
  async compute(graph: LayoutGraph, options: LayeredLayoutOptions) {
    const g = new Graph<GraphLabel, NodeLabel, EdgeLabel>();
    g.setGraph({
      rankdir: options.direction ?? 'TB',
      nodesep: options.nodeSeparation ?? 50,
      ranksep: options.rankSeparation ?? 80,
      edgesep: options.edgeSeparation ?? 20,
    });
    g.setDefaultEdgeLabel(() => ({}));
    for (const node of graph.nodes) {
      g.setNode(node.id, { width: node.size.width, height: node.size.height });
    }
    for (const edge of graph.edges) {
      if (edge.source === edge.target) continue; // self-loops: not part of ranking
      g.setEdge(edge.source, edge.target);
    }
    dagreLayout(g);

    const positions = new Map<string, Point>();
    for (const node of graph.nodes) {
      const label = g.node(node.id);
      if (label) positions.set(node.id, { x: label.x ?? 0, y: label.y ?? 0 });
    }
    return { positions };
  },
};
