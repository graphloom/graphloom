// Phase Gate G6 (perf smoke, active from P3): the pipeline at the ADR-0007
// limits (500 nodes / 2000 edges) must stay comfortably inside generous
// multiples of the 16ms frame budget. The real 60fps benchmark suite is
// P9-T03; this only catches order-of-magnitude regressions, so thresholds
// carry CI-runner slack.
import { commands, createGraph } from '@graphloom/core';
import { describe, expect, it } from 'vitest';
import { FrameBuilder } from './frame.js';
import { SceneGraph } from './scene.js';
import { SpatialIndex } from './spatial.js';
import { ViewportController } from './viewport.js';

describe('perf smoke at ADR-0007 limits (500 nodes / 2000 edges)', () => {
  it('derives, updates, and frames within generous budgets', () => {
    const editor = createGraph();
    const t0 = performance.now();
    editor.transact(() => {
      for (let i = 0; i < 500; i++) {
        editor.execute(
          commands.nodeAdd({
            id: `n${i}`,
            position: { x: (i % 25) * 160, y: Math.floor(i / 25) * 100 },
            size: { width: 120, height: 48 },
            data: { label: `Node ${i}` },
          }),
        );
      }
      for (let stride = 1; stride <= 4; stride++) {
        for (let i = 0; i < 500; i++) {
          editor.execute(
            commands.edgeAdd({
              id: `e${stride}-${i}`,
              source: `n${i}`,
              target: `n${(i + stride) % 500}`,
            }),
          );
        }
      }
    });
    const build = performance.now() - t0;

    const t1 = performance.now();
    const scene = new SceneGraph(editor);
    const derive = performance.now() - t1;
    expect(scene.size).toBe(3000); // 500 shapes + 500 labels + 2000 paths

    const index = new SpatialIndex(scene);
    const viewport = new ViewportController({ size: { width: 1600, height: 900 } });
    const builder = new FrameBuilder(index, viewport);
    const t2 = performance.now();
    builder.frame(); // first frame: full quadtree build + cull
    const firstFrame = performance.now() - t2;

    // Interactive steady state: move one node (8 incident edges) + hit test
    // + next frame — the pieces behind one pointermove at the limits.
    const t3 = performance.now();
    editor.execute(commands.nodeUpdate('n250', { position: { x: 40, y: 40 } }));
    index.hitTest({ x: 60, y: 60 }, { tolerance: 4 });
    builder.frame();
    const interactive = performance.now() - t3;

    // Generous CI-slack multiples of the 16ms budget (order-of-magnitude guard).
    expect(build).toBeLessThan(2000);
    expect(derive).toBeLessThan(1000);
    expect(firstFrame).toBeLessThan(500);
    expect(interactive).toBeLessThan(100);
  });
});
