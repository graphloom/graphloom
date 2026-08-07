import { forceCenter, forceLink, forceManyBody, forceSimulation } from 'd3-force';
import type { Point } from '@graphloom/core';
import type { LayoutContext, LayoutEngine, LayoutGraph } from './contract.js';

/** Options for {@link forceLayout}. */
export interface ForceLayoutOptions {
  /** Simulation ticks to run. Default 300 — enough to settle a max-limit graph (ADR-0007). */
  readonly iterations?: number;
  /** Target rest length of links, in graph units. Default 100. */
  readonly linkDistance?: number;
  /** Node repulsion strength (negative = repel). Default -300. */
  readonly chargeStrength?: number;
  /** Point the simulation centers around. Default `{x: 0, y: 0}`. */
  readonly center?: Point;
}

interface SimNode {
  readonly id: string;
  x: number;
  y: number;
}

function snapshot(nodes: readonly SimNode[]): Map<string, Point> {
  const positions = new Map<string, Point>();
  for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y });
  return positions;
}

/**
 * Force-directed layout via {@link https://d3js.org/d3-force d3-force}.
 * Runs `iterations` simulation ticks synchronously and returns the settled
 * positions. Every 10 ticks it also streams the interim positions via
 * `ctx.reportPreview` — the live-preview mode from the spec: a caller can
 * render those as an ephemeral, non-committing overlay while the run is in
 * flight, then either let it settle naturally or call `LayoutRunner.stop()`
 * to commit whatever's on screen early (as opposed to `cancel()`, which
 * discards). This engine doesn't need to know which one happens — it just
 * streams positions and honors `ctx.signal` like any other engine.
 *
 * Simulation nodes are seeded from each node's current center, so the run is
 * deterministic without needing a seeded RNG: d3-force only randomizes
 * initial positions that are otherwise unset, and every node here already
 * has one.
 */
export const forceLayout: LayoutEngine<ForceLayoutOptions> = {
  id: 'force',
  async compute(graph: LayoutGraph, options: ForceLayoutOptions, ctx: LayoutContext) {
    const iterations = options.iterations ?? 300;
    const center = options.center ?? { x: 0, y: 0 };
    const nodes: SimNode[] = graph.nodes.map((n) => ({
      id: n.id,
      x: n.position.x + n.size.width / 2,
      y: n.position.y + n.size.height / 2,
    }));
    const links = graph.edges
      .filter((edge) => edge.source !== edge.target)
      .map((edge) => ({ source: edge.source, target: edge.target }));

    const simulation = forceSimulation(nodes)
      .force('charge', forceManyBody().strength(options.chargeStrength ?? -300))
      .force(
        'link',
        forceLink<SimNode, { source: string; target: string }>(links)
          .id((n) => n.id)
          .distance(options.linkDistance ?? 100),
      )
      .force('center', forceCenter(center.x, center.y))
      .stop();

    for (let i = 0; i < iterations; i++) {
      if (ctx.signal.aborted) break;
      simulation.tick();
      if (i % 10 === 0) {
        ctx.reportProgress(i / iterations);
        ctx.reportPreview(snapshot(nodes));
      }
    }

    return { positions: snapshot(nodes) };
  },
};
