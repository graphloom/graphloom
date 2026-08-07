import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { describe, expect, it, vi } from 'vitest';
import { SceneGraph } from './scene.js';
import { createLayoutTransition, type LayoutTransition } from './transitions.js';

const addNode = (editor: GraphEditor, id: string, x = 0, y = 0): void => {
  editor.execute(commands.nodeAdd({ id, position: { x, y }, size: { width: 100, height: 40 } }));
};

/**
 * Real callers commit the model to its final position immediately (one
 * transaction, per T06's "history records final positions only" acceptance
 * bullet) and only THEN start the visual ease — the transition never touches
 * the model itself. Tests mirror that sequencing so "override cleared"
 * assertions land on the real final position, not the pre-layout one.
 */
const commit = (editor: GraphEditor, id: string, position: { x: number; y: number }): void => {
  editor.execute(commands.nodeUpdate(id, { position }));
};

/** A manually-advanced clock/scheduler — no real timers, fully deterministic. */
function fakeClock(): {
  now: () => number;
  schedule: (cb: () => void) => number;
  cancelSchedule: (handle: number) => void;
  /** Advances the clock and runs whatever frame(s) were pending. */
  advance: (ms: number) => void;
} {
  let time = 0;
  let nextHandle = 1;
  const pending = new Map<number, () => void>();
  return {
    now: () => time,
    schedule: (cb) => {
      const handle = nextHandle++;
      pending.set(handle, cb);
      return handle;
    },
    cancelSchedule: (handle) => {
      pending.delete(handle);
    },
    advance(ms) {
      time += ms;
      const due = [...pending.values()];
      pending.clear();
      for (const cb of due) cb();
    },
  };
}

function setup(): { editor: GraphEditor; scene: SceneGraph; clock: ReturnType<typeof fakeClock> } {
  const editor = createGraph();
  const scene = new SceneGraph(editor);
  addNode(editor, 'a', 0, 0);
  addNode(editor, 'b', 0, 0);
  return { editor, scene, clock: fakeClock() };
}

describe('createLayoutTransition', () => {
  it('eases a position from `from` to `to` over the duration, then clears the override', async () => {
    const { editor, scene, clock } = setup();
    const transition = createLayoutTransition(scene, {
      duration: 100,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      reducedMotion: false,
    });

    const targets = new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]);
    commit(editor, 'a', { x: 100, y: 0 }); // the model commits the final position immediately
    const done = transition.run(targets);
    expect(transition.active).toBe(true);

    clock.advance(50); // halfway
    const mid = scene.get('node:a');
    expect(mid?.bounds.x).toBeGreaterThan(0);
    expect(mid?.bounds.x).toBeLessThan(100);
    expect(scene.hasPositionOverride('a')).toBe(true);

    clock.advance(50); // reaches the full 100ms
    expect(await done).toBe(true);
    expect(scene.hasPositionOverride('a')).toBe(false);
    expect(scene.get('node:a')).toMatchObject({ rect: { x: 100, y: 0 } });
    expect(transition.active).toBe(false);
  });

  it('emits transition.completed with the settled node ids', async () => {
    const { scene, clock } = setup();
    const transition = createLayoutTransition(scene, {
      duration: 10,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      reducedMotion: false,
    });
    const completed = vi.fn();
    transition.on('transition.completed', completed);

    const done = transition.run(new Map([['a', { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }]]));
    clock.advance(10);
    await done;

    expect(completed).toHaveBeenCalledWith({ nodeIds: ['a'] });
  });

  it('reduced motion jumps straight to final positions — no override, no easing', async () => {
    const { scene } = setup();
    const transition = createLayoutTransition(scene, { reducedMotion: true });

    const applied = await transition.run(
      new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]),
    );

    expect(applied).toBe(true);
    // The model already holds the final position — reduced motion never
    // needs to touch the scene at all, so no override was ever set.
    expect(scene.hasPositionOverride('a')).toBe(false);
  });

  it('runs instantly when no frame scheduler is available (SSR-safe default)', async () => {
    const { scene } = setup();
    // No `schedule` passed and no requestAnimationFrame in this test
    // environment (plain Node) — the factory's own fallback applies.
    const transition = createLayoutTransition(scene, { reducedMotion: false });

    const applied = await transition.run(
      new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]),
    );

    expect(applied).toBe(true);
    expect(scene.hasPositionOverride('a')).toBe(false);
  });

  it('with no options at all, defaults to the SSR-safe instant fallback', async () => {
    const { scene } = setup();
    // Plain Node test env: no requestAnimationFrame — the "nothing
    // available" default fallback applies without any injected clock.
    const transition = createLayoutTransition(scene);

    const applied = await transition.run(
      new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]),
    );

    expect(applied).toBe(true);
  });

  it('probes matchMedia for reduced-motion when the option is not pinned', async () => {
    const { editor, scene, clock } = setup();
    // A real scheduler is injected (so `run()` doesn't take the "no
    // scheduler" instant shortcut) but `reducedMotion` is deliberately
    // omitted, forcing the `matchMedia` probe — absent in plain Node, so it
    // resolves to "not reduced" and eases normally.
    const transition = createLayoutTransition(scene, {
      duration: 10,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
    });

    commit(editor, 'a', { x: 100, y: 0 });
    const done = transition.run(new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]));
    expect(scene.hasPositionOverride('a')).toBe(true); // eased, not instant
    clock.advance(10);

    expect(await done).toBe(true);
  });

  it('empty targets resolve true immediately without touching the scene', async () => {
    const { scene, clock } = setup();
    const transition = createLayoutTransition(scene, {
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
    });

    expect(await transition.run(new Map())).toBe(true);
    expect(transition.active).toBe(false);
  });

  it('cancel() snaps all in-flight nodes to their final target and resolves false', async () => {
    const { editor, scene, clock } = setup();
    const transition = createLayoutTransition(scene, {
      duration: 1000,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      reducedMotion: false,
    });
    const completed = vi.fn();
    transition.on('transition.completed', completed);

    commit(editor, 'a', { x: 100, y: 0 });
    const done = transition.run(
      new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]),
    );
    clock.advance(1); // barely started
    transition.cancel();

    expect(await done).toBe(false);
    expect(transition.active).toBe(false);
    expect(scene.hasPositionOverride('a')).toBe(false);
    expect(scene.get('node:a')).toMatchObject({ rect: { x: 100, y: 0 } }); // snapped to final
    expect(completed).not.toHaveBeenCalled();
  });

  it('cancel(ids) is partial: only those nodes snap early, the rest keep easing', async () => {
    const { editor, scene, clock } = setup();
    const transition = createLayoutTransition(scene, {
      duration: 100,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      reducedMotion: false,
    });
    const completed = vi.fn();
    transition.on('transition.completed', completed);

    commit(editor, 'a', { x: 100, y: 0 });
    commit(editor, 'b', { x: 200, y: 0 });
    const done = transition.run(
      new Map([
        ['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }],
        ['b', { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }],
      ]),
    );
    clock.advance(50);
    transition.cancel(['a']); // interaction grabbed node a mid-transition

    expect(scene.hasPositionOverride('a')).toBe(false);
    expect(scene.get('node:a')).toMatchObject({ rect: { x: 100, y: 0 } });
    expect(transition.active).toBe(true); // b is still going
    expect(transition.nodeIds.has('b')).toBe(true);

    clock.advance(50);
    expect(await done).toBe(true);
    expect(completed).toHaveBeenCalledWith({ nodeIds: ['b'] }); // only the survivor
  });

  it('run() supersedes an in-flight run: old nodes snap to their own final target first', async () => {
    const { editor, scene, clock } = setup();
    const transition = createLayoutTransition(scene, {
      duration: 100,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      reducedMotion: false,
    });

    commit(editor, 'a', { x: 100, y: 0 });
    const first = transition.run(
      new Map([['a', { from: { x: 0, y: 0 }, to: { x: 100, y: 0 } }]]),
    );
    clock.advance(50);
    commit(editor, 'b', { x: 200, y: 0 });
    const second = transition.run(
      new Map([['b', { from: { x: 0, y: 0 }, to: { x: 200, y: 0 } }]]),
    );

    expect(await first).toBe(false); // superseded, not settled
    expect(scene.get('node:a')).toMatchObject({ rect: { x: 100, y: 0 } }); // snapped to its own final
    expect(transition.nodeIds.has('b')).toBe(true);

    clock.advance(100);
    expect(await second).toBe(true);
  });

  it('a standalone LayoutTransition instance does not leak state across runs', async () => {
    const { scene, clock } = setup();
    const transition: LayoutTransition = createLayoutTransition(scene, {
      duration: 10,
      now: clock.now,
      schedule: clock.schedule,
      cancelSchedule: clock.cancelSchedule,
      reducedMotion: false,
    });

    const done1 = transition.run(new Map([['a', { from: { x: 0, y: 0 }, to: { x: 10, y: 0 } }]]));
    clock.advance(10);
    await done1;

    const done2 = transition.run(new Map([['b', { from: { x: 0, y: 0 }, to: { x: 20, y: 0 } }]]));
    clock.advance(10);
    expect(await done2).toBe(true);
    expect(transition.nodeIds.size).toBe(0);
  });
});
