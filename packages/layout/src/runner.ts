import {
  Emitter,
  commands,
  type Command,
  type ExecuteOptions,
  type GraphView,
  type Unsubscribe,
} from '@graphloom/core';
import type { Point } from '@graphloom/core';
import type { LayoutContext, LayoutEngine, LayoutGraph, LayoutResult } from './contract.js';

/** Events emitted by a {@link LayoutRunner}. */
export interface LayoutEventMap {
  /** An in-flight run reported progress. */
  'layout.progress': { readonly layout: string; readonly ratio: number };
  /** An in-flight run streamed interim positions for a live-preview UI (see `LayoutContext.reportPreview`). */
  'layout.preview': { readonly layout: string; readonly positions: ReadonlyMap<string, Point> };
  /** A run finished and its positions were applied as one transaction. */
  'layout.completed': { readonly layout: string };
}

/**
 * The slice of a `GraphEditor` a layout run needs — kept structural so the
 * runner works with anything that exposes the core command/model surface.
 */
export interface LayoutEditor {
  readonly graph: GraphView;
  execute(command: Command, options?: ExecuteOptions): void;
  transact(fn: () => void, options?: ExecuteOptions): void;
}

/** Options for {@link LayoutRunner.run}. */
export interface RunLayoutOptions<Options> {
  readonly options: Options;
  /** Node ids to lay out; defaults to every node (subset/selection layouts). */
  readonly nodeIds?: readonly string[];
  /** Coalescing hint forwarded to the applying transaction. */
  readonly coalesceKey?: string;
}

/**
 * Runs layout engines against an editor and applies their results as one
 * undoable transaction. Only one run is ever in flight; starting a new one
 * cancels the previous.
 */
export interface LayoutRunner {
  /** Whether a run is currently in flight. */
  readonly running: boolean;
  /**
   * Runs `engine`, then applies its result as one `node.update` per
   * positioned node inside a single transaction (one history entry).
   * Resolves `true` when positions were applied, `false` when the run was
   * cancelled or superseded with no positions to fall back on (no model
   * mutation in that case).
   */
  run<Options>(engine: LayoutEngine<Options>, opts: RunLayoutOptions<Options>): Promise<boolean>;
  /** Cancels the in-flight run, if any (no-op otherwise): discards it entirely, no commit. */
  cancel(): void;
  /**
   * Stops the in-flight run early, if any (no-op otherwise), and commits the
   * most recent positions it streamed via `LayoutContext.reportPreview` as
   * one transaction — same as a natural settle, just cut short. A run that
   * never reported preview positions has nothing to commit and behaves like
   * `cancel`.
   */
  stop(): void;
  /** Subscribes to {@link LayoutEventMap} events. */
  on<K extends keyof LayoutEventMap>(
    type: K,
    handler: (payload: LayoutEventMap[K]) => void,
  ): Unsubscribe;
}

function snapshotGraph(graph: GraphView, nodeIds: readonly string[] | undefined): LayoutGraph {
  const wanted = nodeIds ? new Set(nodeIds) : undefined;
  const nodes = graph
    .nodes()
    .filter((node) => !wanted || wanted.has(node.id))
    .map((node) => ({ id: node.id, position: node.position, size: node.size }));
  const included = new Set(nodes.map((node) => node.id));
  const edges = graph
    .edges()
    .filter((edge) => included.has(edge.source) && included.has(edge.target))
    .map((edge) => ({ id: edge.id, source: edge.source, target: edge.target }));
  return { nodes, edges };
}

function applyResult(
  editor: LayoutEditor,
  result: LayoutResult,
  coalesceKey: string | undefined,
): void {
  const options: ExecuteOptions = coalesceKey === undefined ? {} : { coalesceKey };
  editor.transact(() => {
    for (const [id, center] of result.positions) {
      const node = editor.graph.getNode(id);
      if (!node) continue; // removed mid-run
      const position = { x: center.x - node.size.width / 2, y: center.y - node.size.height / 2 };
      if (node.position.x === position.x && node.position.y === position.y) continue;
      editor.execute(commands.nodeUpdate(id, { position }));
    }
  }, options);
}

interface RunState {
  stopRequested: boolean;
  lastPreview: ReadonlyMap<string, Point> | null;
}

/** Creates a {@link LayoutRunner} attached to `editor`. */
export function createLayoutRunner(editor: LayoutEditor): LayoutRunner {
  const emitter = new Emitter<LayoutEventMap>();
  let controller: AbortController | null = null;
  // Owned by the in-flight run; `stop()` mutates it from outside. Read via
  // the closure-captured `state` inside `run`, not this variable, so a
  // superseding run resetting it can't race the previous run's own commit
  // decision (each run only ever inspects its own state object).
  let currentRunState: RunState | null = null;

  return {
    get running() {
      return controller !== null;
    },
    async run(engine, opts) {
      controller?.abort();
      const own = new AbortController();
      controller = own;
      const state: RunState = { stopRequested: false, lastPreview: null };
      currentRunState = state;
      const graph = snapshotGraph(editor.graph, opts.nodeIds);
      const ctx: LayoutContext = {
        signal: own.signal,
        reportProgress: (ratio) => {
          if (own.signal.aborted) return;
          emitter.emit('layout.progress', { layout: engine.id, ratio });
        },
        reportPreview: (positions) => {
          if (own.signal.aborted) return;
          state.lastPreview = positions;
          emitter.emit('layout.preview', { layout: engine.id, positions });
        },
      };
      let result: LayoutResult | undefined;
      try {
        result = await engine.compute(graph, opts.options, ctx);
      } catch (error) {
        if (!own.signal.aborted) throw error;
      } finally {
        if (controller === own) controller = null;
        if (currentRunState === state) currentRunState = null;
      }

      if (own.signal.aborted) {
        // stop(): commit the engine's own (possibly partial) return value if
        // it has one, else fall back to the last streamed preview. cancel()
        // leaves `stopRequested` false, so this is always `null` — same
        // discard-everything behavior as before stop() existed.
        const positions = state.stopRequested
          ? result && result.positions.size > 0
            ? result.positions
            : state.lastPreview
          : null;
        if (!positions || positions.size === 0) return false;
        applyResult(editor, { positions }, opts.coalesceKey);
        emitter.emit('layout.completed', { layout: engine.id });
        return true;
      }

      // Not aborted: compute() either resolved (result is set) or threw and
      // we already rethrew above — result is always defined here.
      applyResult(editor, result!, opts.coalesceKey);
      emitter.emit('layout.completed', { layout: engine.id });
      return true;
    },
    cancel() {
      controller?.abort();
    },
    stop() {
      if (currentRunState) currentRunState.stopRequested = true;
      controller?.abort();
    },
    on: (type, handler) => emitter.on(type, handler),
  };
}
