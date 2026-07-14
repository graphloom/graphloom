// P7 close-out gallery: every built-in shape, edge geometry, marker and
// visual state under the theme engine, with a live light/dark toggle.
// Deterministic on purpose — Playwright screenshots this page per theme.
import { commands, createGraph, type Theme } from '@graphloom/core';
import {
  createRouters,
  createSvgRenderer,
  mountRenderer,
} from '@graphloom/rendering';
import { darkTheme, lightTheme, themeToCssVariables } from '@graphloom/themes';

const app = document.querySelector('#app') as HTMLElement;
app.innerHTML = `
  <style>
    body { margin: 0; font-family: system-ui, sans-serif; }
    #app { display: flex; flex-direction: column; height: 100vh; }
    header {
      display: flex; align-items: center; gap: 12px; padding: 8px 16px;
      border-bottom: 1px solid var(--gl-grid, #d4d9e4);
      background: var(--gl-background, #ffffff);
      color: var(--gl-node-text, #1a1f36);
    }
    header strong { margin-right: 8px; }
    header button { padding: 4px 10px; }
    #canvas { flex: 1; min-height: 0; background: var(--gl-background, #ffffff); }
  </style>
  <header>
    <strong>GraphLoom shape gallery</strong>
    <button id="theme-toggle" type="button" data-testid="theme-toggle">Toggle theme</button>
    <span>theme: <span id="theme-name" data-testid="theme-name"></span></span>
  </header>
  <div id="canvas" data-testid="canvas"></div>
`;

const SHAPES = [
  'rectangle',
  'rounded-rectangle',
  'circle',
  'diamond',
  'triangle',
  'hexagon',
  'database',
  'queue',
  'cloud',
  'folder',
  'document',
  'person',
  'server',
  'api',
  'storage',
  'container',
  'image',
  'svg',
  'icon',
];

// Inline sources keep the page network-free and byte-deterministic.
const INLINE_SVG =
  '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10"><rect width="10" height="10" fill="#7a95f0"/><circle cx="5" cy="5" r="3" fill="#ffffff"/></svg>';
const DATA_IMAGE = `data:image/svg+xml;utf8,${encodeURIComponent(INLINE_SVG)}`;

const editor = createGraph({ meta: { name: 'Shape gallery' } });
editor.transact(() => {
  // The shape grid: 5 columns, labeled by type, a couple rotated.
  SHAPES.forEach((type, i) => {
    const col = i % 5;
    const row = Math.floor(i / 5);
    editor.execute(
      commands.nodeAdd({
        id: `s-${type}`,
        type,
        position: { x: col * 230, y: row * 170 },
        size: { width: 150, height: 95 },
        rotation: type === 'diamond' || type === 'document' ? 15 : 0,
        data: {
          label: type,
          labelPosition: 'outside',
          ...(type === 'image' && { src: DATA_IMAGE }),
          ...(type === 'svg' && { svg: INLINE_SVG }),
          ...(type === 'icon' && { icon: 'gear' }),
        },
        ...(type === 'triangle' && {
          ports: [
            { id: 'left', side: 'left' as const, visibility: 'always' as const },
            { id: 'right', side: 'right' as const, visibility: 'always' as const },
          ],
        }),
      }),
    );
  });

  // Edge geometry row: one small pair per routing kind, marker-decorated.
  const edgeY = 4 * 170 + 60;
  const pairs: Array<{
    routing: 'straight' | 'bezier' | 'smooth' | 'orthogonal';
    markers: { markerStart?: string; markerEnd?: string };
  }> = [
    { routing: 'straight', markers: { markerEnd: 'arrow' } },
    { routing: 'bezier', markers: { markerStart: 'circle', markerEnd: 'arrow' } },
    { routing: 'smooth', markers: { markerEnd: 'diamond' } },
    { routing: 'orthogonal', markers: { markerStart: 'bar', markerEnd: 'open-arrow' } },
  ];
  pairs.forEach(({ routing, markers }, i) => {
    const x = i * 290;
    editor.execute(
      commands.nodeAdd({
        id: `${routing}-a`,
        position: { x, y: edgeY },
        size: { width: 80, height: 40 },
        data: { label: routing },
      }),
    );
    editor.execute(
      commands.nodeAdd({
        id: `${routing}-b`,
        position: { x: x + 160, y: edgeY + 90 },
        size: { width: 80, height: 40 },
      }),
    );
    editor.execute(
      commands.edgeAdd({
        id: `e-${routing}`,
        source: `${routing}-a`,
        target: `${routing}-b`,
        routing,
        data: markers,
      }),
    );
  });

  // Parallel fanning + a self-loop with a crow's-foot.
  const fanY = edgeY + 220;
  editor.execute(
    commands.nodeAdd({ id: 'fan-a', position: { x: 0, y: fanY }, size: { width: 80, height: 40 }, data: { label: 'fanning' } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'fan-b', position: { x: 300, y: fanY }, size: { width: 80, height: 40 } }),
  );
  for (const suffix of ['1', '2', '3']) {
    editor.execute(
      commands.edgeAdd({ id: `fan-${suffix}`, source: 'fan-a', target: 'fan-b' }),
    );
  }
  editor.execute(
    commands.nodeAdd({ id: 'loop', position: { x: 520, y: fanY }, size: { width: 80, height: 40 }, data: { label: 'self-loop' } }),
  );
  editor.execute(
    commands.edgeAdd({ id: 'e-loop', source: 'loop', target: 'loop', data: { markerEnd: 'crows-foot' } }),
  );

  // Visual states row (P7-T08): selected / hovered / dragging / locked.
  const stateY = fanY + 180;
  for (const [i, state] of (['selected', 'hovered', 'dragging', 'locked'] as const).entries()) {
    editor.execute(
      commands.nodeAdd({
        id: `state-${state}`,
        type: 'rounded-rectangle',
        position: { x: i * 230, y: stateY },
        size: { width: 150, height: 70 },
        locked: state === 'locked',
        data: { label: state },
        ...(state === 'hovered' && {
          ports: [{ id: 'p', side: 'right' as const }], // hover reveals it
        }),
      }),
    );
  }

  // Collapsed group with the member-count badge.
  editor.execute(
    commands.nodeAdd({ id: 'g-1', position: { x: 940, y: stateY }, size: { width: 100, height: 50 } }),
  );
  editor.execute(
    commands.nodeAdd({ id: 'g-2', position: { x: 1080, y: stateY + 30 }, size: { width: 100, height: 50 } }),
  );
  editor.execute(commands.groupCreate({ id: 'grp', members: ['g-1', 'g-2'], label: 'group' }));
  editor.execute(commands.groupCollapse('grp'));
});

const canvas = document.querySelector('#canvas') as HTMLElement;
const svg = createSvgRenderer();
const host = mountRenderer(editor, svg, canvas, {
  // Obstacle-aware orthogonal routing on (P7-T05); default demos keep it off.
  scene: { routers: createRouters({ avoidBodies: true }) },
  // The showcase stays at full LOD regardless of the fitted zoom.
  frame: { simplifiedBelow: 0.1, dotBelow: 0.02, labelsBelow: 0.05 },
});

host.scene.setVisualStates(
  new Map([
    ['state-selected', { selected: true, hovered: false, dragging: false }],
    ['state-hovered', { selected: false, hovered: true, dragging: false }],
    ['state-dragging', { selected: false, hovered: false, dragging: true }],
  ]),
);
host.viewport.zoomToFit(host.scene.bounds(), 40);

const themeName = document.querySelector('#theme-name') as HTMLElement;
const applyTheme = (theme: Theme): void => {
  host.scene.setTheme(theme);
  svg.setGrid({ color: theme.tokens.grid });
  // Page chrome themes through the CSS-variable projection (spec §Theming).
  for (const [name, value] of Object.entries(themeToCssVariables(theme))) {
    document.documentElement.style.setProperty(name, value);
  }
  themeName.textContent = theme.name;
  host.refresh();
};
applyTheme(lightTheme);

(document.querySelector('#theme-toggle') as HTMLElement).onclick = () => {
  applyTheme(host.scene.theme === lightTheme ? darkTheme : lightTheme);
};

// Exposed for the e2e suite (theme switching + scene/model inspection).
declare global {
  interface Window {
    gallery: { host: typeof host; editor: typeof editor; applyTheme: typeof applyTheme };
  }
}
window.gallery = { host, editor, applyTheme };
