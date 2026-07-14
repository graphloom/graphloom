import { commands, createGraph, type GraphEditor } from '@graphloom/core';
import { mountRenderer, type RenderHost } from './host.js';
import type { Renderer } from './renderer.js';

/**
 * One renderer-agnostic contract check. Throws a descriptive `Error` on
 * violation. Runs in any DOM environment (jsdom for unit tests, a browser
 * for e2e) — no test-framework dependency, so P9's Canvas backend and future
 * WebGL run the exact same suite (parity insurance, P3-T06).
 */
export interface ConformanceCheck {
  readonly name: string;
  run(createRenderer: () => Renderer): void;
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(`renderer conformance: ${message}`);
}

function withPipeline(
  createRenderer: () => Renderer,
  fn: (host: RenderHost, editor: GraphEditor, element: HTMLElement) => void,
): void {
  const element = document.createElement('div');
  // jsdom has no layout: stub the client box the host mount reads.
  Object.defineProperty(element, 'clientWidth', { value: 800, configurable: true });
  Object.defineProperty(element, 'clientHeight', { value: 600, configurable: true });
  document.body.appendChild(element);
  const editor = createGraph();
  editor.execute(
    commands.nodeAdd({
      id: 'a',
      position: { x: 100, y: 100 },
      size: { width: 100, height: 40 },
      data: { label: 'A' },
    }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'b', position: { x: 400, y: 300 }, size: { width: 100, height: 40 } }),
  );
  editor.execute(commands.edgeAdd({ id: 'e', source: 'a', target: 'b' }));
  const host = mountRenderer(editor, createRenderer(), element);
  try {
    fn(host, editor, element);
  } finally {
    host.destroy();
    element.remove();
  }
}

/** The individual checks, exposed so test runners can report them one by one. */
export const rendererConformanceChecks: readonly ConformanceCheck[] = [
  {
    name: 'renders a frame after mount and hit-tests it (no DOM event targets)',
    run(createRenderer) {
      withPipeline(createRenderer, (host) => {
        check(host.renderer.hitTest({ x: 110, y: 135 }) === 'node:a', 'node body should hit');
        check(host.renderer.hitTest({ x: 110, y: 135 }) !== null, 'hit should not be null');
        check(host.renderer.hitTest({ x: 700, y: 50 }) === null, 'empty space should miss');
        // Exact midpoint of the a→b center line (renderer hitTest has no slop).
        check(host.renderer.hitTest({ x: 300, y: 220 }) === 'edge:e', 'edge midpoint should hit');
      });
    },
  },
  {
    name: 'hit testing tracks the latest frame (stateless w.r.t. the model)',
    run(createRenderer) {
      withPipeline(createRenderer, (host, editor) => {
        editor.execute(commands.nodeUpdate('a', { position: { x: 300, y: 500 } }));
        host.renderNow();
        check(host.renderer.hitTest({ x: 310, y: 535 }) === 'node:a', 'new position should hit');
        check(host.renderer.hitTest({ x: 110, y: 135 }) === null, 'old position should miss');
      });
    },
  },
  {
    name: 'hit testing respects the viewport transform at any zoom',
    run(createRenderer) {
      withPipeline(createRenderer, (host) => {
        host.viewport.setViewport({ x: -80, y: 40, zoom: 2 });
        host.renderNow();
        // World (110,135) → screen (110·2−80, 135·2+40) = (140, 310).
        check(host.renderer.hitTest({ x: 140, y: 310 }) === 'node:a', 'zoomed point should hit');
        check(host.renderer.hitTest({ x: 110, y: 135 }) === null, 'unzoomed point should miss');
      });
    },
  },
  {
    name: 'destroy + recreate mid-session is lossless (renderer swap)',
    run(createRenderer) {
      withPipeline(createRenderer, (host, _editor, element) => {
        host.setRenderer(createRenderer());
        check(host.renderer.hitTest({ x: 110, y: 135 }) === 'node:a', 'swap should be lossless');
        check(element.isConnected, 'host element should remain in the document');
      });
    },
  },
  {
    name: 'destroy detaches everything it added to the host',
    run(createRenderer) {
      const element = document.createElement('div');
      document.body.appendChild(element);
      const renderer = createRenderer();
      renderer.mount(element);
      renderer.destroy();
      check(element.childNodes.length === 0, 'host should be empty after destroy');
      element.remove();
    },
  },
  {
    name: 'render before mount throws',
    run(createRenderer) {
      const renderer = createRenderer();
      let threw = false;
      try {
        renderer.render({
          items: [],
          dirty: { added: [], updated: [], removed: [] },
          viewport: { x: 0, y: 0, zoom: 1 },
          devicePixelRatio: 1,
          lod: 'full',
        });
      } catch {
        threw = true;
      }
      check(threw, 'render() before mount() must throw');
    },
  },
  {
    name: 'renders the full ShapeSpec vocabulary and hit-tests non-rect geometry (P7-T01)',
    run(createRenderer) {
      withPipeline(createRenderer, (host, editor) => {
        editor.use({
          id: 'conformance-shapes',
          version: '0.0.0',
          install(ctx) {
            // Every spec primitive kind in one descriptor (P7-T01 acceptance:
            // conformance extended to every spec element).
            ctx.shapes.register('vocabulary', (node) => ({
              role: 'node',
              label: node.id,
              children: [
                { kind: 'rect', x: 0, y: 0, width: 100, height: 100 },
                { kind: 'roundRect', x: 10, y: 10, width: 20, height: 20, radius: 4 },
                { kind: 'ellipse', cx: 70, cy: 20, rx: 10, ry: 10 },
                {
                  kind: 'polygon',
                  points: [
                    { x: 50, y: 60 },
                    { x: 90, y: 95 },
                    { x: 10, y: 95 },
                  ],
                },
                {
                  kind: 'path',
                  segments: [
                    { kind: 'M', to: { x: 10, y: 40 } },
                    { kind: 'Q', c: { x: 30, y: 30 }, to: { x: 50, y: 40 } },
                    { kind: 'C', c1: { x: 60, y: 45 }, c2: { x: 80, y: 45 }, to: { x: 90, y: 40 } },
                  ],
                  style: { fill: 'none' },
                },
                { kind: 'text', text: 'v', x: 50, y: 30 },
                {
                  kind: 'image',
                  href: 'data:image/svg+xml;utf8,%3Csvg%20xmlns%3D%22http%3A%2F%2Fwww.w3.org%2F2000%2Fsvg%22%2F%3E',
                  x: 60,
                  y: 60,
                  width: 16,
                  height: 16,
                },
                { kind: 'icon', icon: 'gear', x: 20, y: 60, size: 16 },
                {
                  kind: 'group',
                  translate: { x: 40, y: 0 },
                  children: [{ kind: 'rect', x: 0, y: 0, width: 8, height: 8 }],
                },
              ],
              anchors: [{ id: 'apex', position: { x: 50, y: 60 } }],
            }));
          },
        });
        editor.execute(
          commands.nodeAdd({
            id: 'v',
            type: 'vocabulary',
            position: { x: 500, y: 400 },
            size: { width: 100, height: 100 },
            ports: [{ id: 'apex', side: 'top', visibility: 'always' }],
          }),
        );
        host.renderNow();
        // Inside the polygon (world 550,485) → some item of node v.
        const polygonHit = host.renderer.hitTest({ x: 550, y: 485 });
        check(polygonHit !== null && polygonHit.startsWith('node:v'), 'polygon interior should hit');
        // Outside the polygon but inside its bounding box → the base rect
        // (item node:v), never the polygon item (node:v:3).
        const offPolygon = host.renderer.hitTest({ x: 515, y: 465 });
        check(offPolygon === 'node:v', 'polygon bounding box must not hit the polygon itself');
        // The always-visible port at the spec anchor (world 550,460).
        const portHit = host.renderer.hitTest({ x: 550, y: 460 });
        check(portHit === 'port:node:v:apex', `port dot should hit (got ${String(portHit)})`);
      });
    },
  },
  {
    name: 'measureText returns sane, monotonic sizes',
    run(createRenderer) {
      const renderer = createRenderer();
      const style = { fontFamily: 'sans-serif', fontSize: 12 };
      const short = renderer.measureText('hi', style);
      const long = renderer.measureText('a much longer line of text', style);
      check(short.width > 0 && short.height > 0, 'sizes must be positive');
      check(long.width > short.width, 'longer text must measure wider');
      renderer.destroy();
    },
  },
];

/** Runs every conformance check; throws on the first violation. */
export function runRendererConformance(createRenderer: () => Renderer): void {
  for (const conformanceCheck of rendererConformanceChecks) {
    conformanceCheck.run(createRenderer);
  }
}
