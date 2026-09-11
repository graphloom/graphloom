// P10-T03 close-out fixture: proves the acceptance line literally — "exported
// SVG renders identically to canvas view in a plain browser tab" — by fitting
// the SAME graph the SAME way into one fixed-size `#stage` box under two
// modes (`?mode=canvas` | `?mode=export`), so e2e/svg-export.spec.ts can
// screenshot both against one baseline. Nav-unlinked, no live-renderer
// consumer of its own beyond the canvas comparison mode.
import { commands, createGraph } from '@graphloom/core';
import { createCanvasRenderer, exportSvg, inflateRect, mountRenderer, SceneGraph } from '@graphloom/rendering';

const mode = new URLSearchParams(location.search).get('mode') === 'export' ? 'export' : 'canvas';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `<style>
  body { margin: 0; background: #fff; }
  #stage { width: 480px; height: 320px; }
  #stage svg { display: block; width: 100%; height: 100%; }
</style><div id="stage"></div>`;
const stage = document.querySelector('#stage') as HTMLElement;

const editor = createGraph();
editor.transact(() => {
  editor.execute(
    commands.nodeAdd({ id: 'alpha', position: { x: 40, y: 40 }, size: { width: 120, height: 48 }, data: { label: 'Alpha' } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'beta', position: { x: 280, y: 40 }, size: { width: 120, height: 48 }, data: { label: 'Beta' } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'gamma', position: { x: 160, y: 180 }, size: { width: 120, height: 48 }, data: { label: 'Gamma' } }),
  );
  editor.execute(commands.edgeAdd({ id: 'ab', source: 'alpha', target: 'beta' }));
});

// Both modes fit this exact world rect into the exact same #stage box —
// `ViewportController.zoomToFit(bounds, 0)` and an SVG `viewBox` scaled to
// fill its container via the default `preserveAspectRatio="xMidYMid meet"`
// are the same "contain, centered" fit, so the two are pixel-comparable.
const scene = new SceneGraph(editor);
const bounds = inflateRect(scene.bounds()!, 40);
scene.destroy();

if (mode === 'canvas') {
  const host = mountRenderer(editor, createCanvasRenderer(), stage);
  host.viewport.zoomToFit(bounds, 0);
  host.renderNow();
} else {
  stage.innerHTML = exportSvg(editor, { bounds, background: null });
}

declare global {
  interface Window {
    __ready: boolean;
  }
}
window.__ready = true;
