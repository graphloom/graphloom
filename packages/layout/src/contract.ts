import type { Point, Size } from '@graphloom/core';

/** The read-only slice of a node a layout engine needs. */
export interface LayoutNode {
  readonly id: string;
  readonly position: Point;
  readonly size: Size;
}

/** The read-only slice of an edge a layout engine needs. */
export interface LayoutEdge {
  readonly id: string;
  readonly source: string;
  readonly target: string;
}

/**
 * A structured-clone-safe snapshot of the nodes/edges a layout run computes
 * positions for — plain data, safe to `postMessage` to a Web Worker
 * (worker-execution engines land in P8-T03/T04). Scoped to a subset when the
 * run targets a selection rather than the whole graph.
 */
export interface LayoutGraph {
  readonly nodes: readonly LayoutNode[];
  readonly edges: readonly LayoutEdge[];
}

/** Passed to {@link LayoutEngine.compute} for cancellation and progress reporting. */
export interface LayoutContext {
  /** Aborts when the run is cancelled; engines should check it between iterations. */
  readonly signal: AbortSignal;
  /** Reports progress in `[0, 1]`. Engines that can't estimate progress may skip this. */
  reportProgress(ratio: number): void;
}

/**
 * Positions computed by a layout run, keyed by node id. Each point is the
 * node's **center** — the natural output of every layout algorithm
 * (d3-hierarchy, dagre, d3-force alike) — not `Node.position` (top-left, per
 * ADR-0002 scene geometry). The runner converts center → top-left using each
 * node's current size when applying the result, so engines never need to
 * know about that convention.
 */
export interface LayoutResult {
  readonly positions: ReadonlyMap<string, Point>;
}

/**
 * One layout algorithm (spec §Layout engines). Implementations are pure
 * functions of their input — no editor/model access — so the same engine
 * runs identically on the main thread or inside a Web Worker. Register an
 * engine via `pluginContext.layouts.register(engine.id, engine)`.
 */
export interface LayoutEngine<Options = void> {
  /** Unique registry key, e.g. `tree`, `layered`, `force`, `grid`, `circular`. */
  readonly id: string;
  /**
   * Computes positions for `graph`. Must settle promptly after
   * `ctx.signal` aborts — the runner discards any result once aborted, so a
   * cooperative engine that stops early just saves wasted work.
   */
  compute(graph: LayoutGraph, options: Options, ctx: LayoutContext): Promise<LayoutResult>;
}
