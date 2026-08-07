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

/**
 * Force-directed layout via {@link https://d3js.org/d3-force d3-force}.
 * One-shot: runs `iterations` simulation ticks synchronously and returns the
 * settled positions — the live-preview mode from the spec (positions
 * streamed to an ephemeral, non-committing overlay; commit on settle or on
 * an explicit stop, as opposed to cancel's discard) needs a runner
 * extension that doesn't exist yet and is deferred with worker execution
 * (Decision Log, 2026-08-07) — there's no consumer yet to design it against.
 *
 * Simulation nodes are seeded from each node's current center, so the run is
 * deterministic without needing a seeded RNG: d3-force only randomizes
 * initial positions that are otherwise unset, and every node here already
 * has one. Cancellation (`ctx.signal`) stops early; the runner discards the
 * partial result like any other cancelled run (T01 contract).
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
      if (i % 10 === 0) ctx.reportProgress(i / iterations);
    }

    const positions = new Map<string, Point>();
    for (const n of nodes) positions.set(n.id, { x: n.x, y: n.y });
    return { positions };
  },
};
