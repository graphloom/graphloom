// P3-T10 rendering demo: a 100-node graph built purely through commands,
// rendered by the SVG backend, with programmatic zoom controls and a hit-test
// readout. Deterministic on purpose — Playwright screenshots this page.
import { commands, createGraph } from '@graphloom/core';
import { createSvgRenderer, mountRenderer } from '@graphloom/rendering';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #app { display: flex; flex-direction: column; height: 100vh; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 8px 16px;
      border-bottom: 1px solid #d4d9e4; background: #f7f9fc;
    }
    header strong { margin-right: 8px; }
    header button { padding: 4px 10px; }
    #canvas { flex: 1; min-height: 0; }
    #hit { color: #3b5bd9; }
  </style>
  <header>
    <strong>GraphLoom examples</strong>
    <button id="zoom-in" type="button">Zoom in</button>
    <button id="zoom-out" type="button">Zoom out</button>
    <button id="zoom-fit" type="button">Zoom to fit</button>
    <span>zoom: <span id="zoom" data-testid="zoom"></span></span>
    <span>hit: <span id="hit" data-testid="hit">—</span></span>
  </header>
  <div id="canvas" data-testid="canvas"></div>
`;

const editor = createGraph({ meta: { name: 'Rendering demo' } });
editor.transact(() => {
  for (let i = 0; i < 100; i++) {
    const col = i % 10;
    const row = Math.floor(i / 10);
    editor.execute(
      commands.nodeAdd({
        id: `n${i}`,
        type: i % 7 === 0 ? 'ellipse' : 'default',
        position: { x: col * 180, y: row * 120 },
        size: { width: 120, height: 48 },
        rotation: i % 13 === 0 ? 15 : 0,
        data: { label: `Node ${i}` },
      }),
    );
  }
  for (let row = 0; row < 10; row++) {
    for (let col = 0; col < 9; col++) {
      const from = row * 10 + col;
      editor.execute(
        commands.edgeAdd({
          id: `e-row-${from}`,
          source: `n${from}`,
          target: `n${from + 1}`,
          routing: from % 4 === 0 ? 'bezier' : 'straight',
        }),
      );
    }
  }
  for (const col of [0, 3, 6, 9]) {
    for (let row = 0; row < 9; row++) {
      const from = row * 10 + col;
      editor.execute(
        commands.edgeAdd({
          id: `e-col-${from}`,
          source: `n${from}`,
          target: `n${from + 10}`,
          routing: 'orthogonal',
        }),
      );
    }
  }
});

const canvas = document.querySelector('#canvas') as HTMLElement;
const host = mountRenderer(editor, createSvgRenderer(), canvas);
host.viewport.zoomToFit(host.scene.bounds(), 40);

const zoomLabel = document.querySelector('#zoom') as HTMLElement;
const showZoom = (): void => {
  zoomLabel.textContent = host.viewport.viewport.zoom.toFixed(2);
};
host.viewport.on('viewport.changed', showZoom);
showZoom();

(document.querySelector('#zoom-in') as HTMLElement).onclick = () => host.viewport.zoomBy(1.25);
(document.querySelector('#zoom-out') as HTMLElement).onclick = () => host.viewport.zoomBy(0.8);
(document.querySelector('#zoom-fit') as HTMLElement).onclick = () =>
  host.viewport.zoomToFit(host.scene.bounds(), 40);

// Hit testing goes through the renderer (core spatial pick — never DOM targets).
const hitLabel = document.querySelector('#hit') as HTMLElement;
canvas.addEventListener('click', (event) => {
  const box = canvas.getBoundingClientRect();
  const hit = host.renderer.hitTest({
    x: event.clientX - box.left,
    y: event.clientY - box.top,
  });
  hitLabel.textContent = hit ?? '—';
});

// Exposed for the e2e suite to drive programmatic pan/zoom/fit.
declare global {
  interface Window {
    graphloom: typeof host;
  }
}
window.graphloom = host;
