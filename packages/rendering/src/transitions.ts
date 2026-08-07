import { Emitter, type Point, type Unsubscribe } from '@graphloom/core';
import type { SceneGraph } from './scene.js';

/** One node's animated move: eases from `from` to `to` (world-space `Node.position`, top-left — not layout's center convention). */
export interface TransitionTarget {
  readonly from: Point;
  readonly to: Point;
}

/** Options for {@link createLayoutTransition}. */
export interface LayoutTransitionOptions {
  /** Ease duration in ms. Default 300. */
  readonly duration?: number;
  /** Maps elapsed ratio `[0,1]` to eased ratio `[0,1]`. Default ease-in-out cubic. */
  readonly easing?: (t: number) => number;
  /**
   * Skips easing and jumps straight to final positions (the model already
   * holds them — there's nothing to catch up on). Default: probes
   * `matchMedia('(prefers-reduced-motion: reduce)')` when available.
   */
  readonly reducedMotion?: boolean;
  /** Injectable clock (testing without real timers). Default `performance.now`/`Date.now`. */
  readonly now?: () => number;
  /** Injectable frame scheduler. Default `requestAnimationFrame`; with neither, runs are instant (SSR-safe). */
  readonly schedule?: (cb: () => void) => number;
  readonly cancelSchedule?: (handle: number) => void;
}

/** Events emitted by a {@link LayoutTransition}. */
export interface LayoutTransitionEventMap {
  /** A run eased every one of its (non-cancelled) nodes through to completion. */
  'transition.completed': { readonly nodeIds: readonly string[] };
}

/**
 * Runs {@link TransitionTarget} batches against a {@link SceneGraph}. Only
 * one run is ever in flight; starting a new one snaps the previous run's
 * nodes to their own final target first (same supersede discipline as
 * `LayoutRunner`).
 */
export interface LayoutTransition {
  /** Whether a run is currently easing. */
  readonly active: boolean;
  /** Ids currently under this run's control. */
  readonly nodeIds: ReadonlySet<string>;
  /**
   * Runs `targets`, easing each node's scene position override from `from`
   * to `to`. Resolves `true` once every node reaches `to` naturally, `false`
   * if the run was cancelled or superseded before that.
   */
  run(targets: ReadonlyMap<string, TransitionTarget>): Promise<boolean>;
  /**
   * Cancels some (default: all) in-flight nodes early: their scene overrides
   * clear immediately, snapping to the model's already-final position — the
   * P8-T06 "drag hands off cleanly" hook, called right before a drag grabs a
   * transitioning node so nothing keeps animating underneath the gesture.
   * The rest of the batch, if any, keeps easing.
   */
  cancel(nodeIds?: readonly string[]): void;
  /** Subscribes to {@link LayoutTransitionEventMap} events. */
  on<K extends keyof LayoutTransitionEventMap>(
    type: K,
    handler: (payload: LayoutTransitionEventMap[K]) => void,
  ): Unsubscribe;
}

const easeInOutCubic = (t: number): number => (t < 0.5 ? 4 * t ** 3 : 1 - (-2 * t + 2) ** 3 / 2);

const defaultNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

const defaultReducedMotion = (): boolean =>
  typeof matchMedia === 'function' && matchMedia('(prefers-reduced-motion: reduce)').matches;

const lerp = (from: Point, to: Point, t: number): Point => ({
  x: from.x + (to.x - from.x) * t,
  y: from.y + (to.y - from.y) * t,
});

/** Creates a {@link LayoutTransition} attached to `scene`. */
export function createLayoutTransition(
  scene: SceneGraph,
  options: LayoutTransitionOptions = {},
): LayoutTransition {
  const duration = options.duration ?? 300;
  const easing = options.easing ?? easeInOutCubic;
  const now = options.now ?? defaultNow;
  const schedule =
    options.schedule ?? (typeof requestAnimationFrame === 'function' ? requestAnimationFrame : null);
  const cancelSchedule =
    options.cancelSchedule ?? (typeof cancelAnimationFrame === 'function' ? cancelAnimationFrame : null);
  // Re-probed per run (unless pinned via options) rather than once at
  // creation, so a long-lived transition picks up an OS setting change.
  const reducedMotion = (): boolean => options.reducedMotion ?? defaultReducedMotion();

  const emitter = new Emitter<LayoutTransitionEventMap>();
  let activeIds = new Set<string>();
  let frameHandle: number | null = null;
  let resolveRun: ((settled: boolean) => void) | null = null;

  const settle = (ids: Iterable<string>): void => {
    for (const id of ids) scene.setPositionOverride(id, null);
  };

  const finish = (settled: boolean): void => {
    if (frameHandle !== null) {
      cancelSchedule?.(frameHandle);
      frameHandle = null;
    }
    const ids = [...activeIds];
    activeIds = new Set();
    if (settled) emitter.emit('transition.completed', { nodeIds: ids });
    resolveRun?.(settled);
    resolveRun = null;
  };

  return {
    get active() {
      return activeIds.size > 0;
    },
    get nodeIds() {
      return activeIds;
    },
    run(targets) {
      if (activeIds.size > 0) {
        settle(activeIds);
        finish(false);
      }
      if (targets.size === 0) return Promise.resolve(true);
      // ponytail: every override triggers a full re-derivation of that
      // node + its edges (same cost a real position commit already pays) —
      // fine at ADR-0007 defaults over a handful of frames, but a very large
      // batch easing every frame for the full duration is an unmeasured
      // cost. Revisit with a batched single-pass refresh if that's ever hot.
      if (!schedule || reducedMotion()) {
        settle(targets.keys());
        return Promise.resolve(true);
      }
      activeIds = new Set(targets.keys());
      const start = now();
      return new Promise<boolean>((resolve) => {
        resolveRun = resolve;
        const tick = (): void => {
          const raw = duration <= 0 ? 1 : Math.min(1, (now() - start) / duration);
          const t = easing(raw);
          for (const [id, target] of targets) {
            if (activeIds.has(id)) scene.setPositionOverride(id, lerp(target.from, target.to, t));
          }
          if (raw >= 1) {
            settle(targets.keys());
            finish(true);
            return;
          }
          frameHandle = schedule(tick);
        };
        // Applied synchronously (not scheduled) so the scene shows `from`
        // immediately — a caller sequences model-commit then `run()` in the
        // same turn, and without this the raw (already-final) model
        // position would paint for one frame before the first tick lands.
        tick();
      });
    },
    cancel(nodeIds) {
      if (activeIds.size === 0) return;
      for (const id of nodeIds ?? activeIds) {
        if (!activeIds.delete(id)) continue;
        scene.setPositionOverride(id, null);
      }
      if (activeIds.size === 0) finish(false);
    },
    on: (type, handler) => emitter.on(type, handler),
  };
}
