// The built-in shape library (P7-T02, spec §Shape Library): every shape is a
// Tier-1 descriptor — pure (node, theme, state) → ShapeSpec (ADR-0003). All
// geometry is computed from node.size in local space, so shapes resize
// correctly by construction and rotate via the node transform.
import type {
  Node,
  PathSegment,
  Point,
  ShapeDescriptor,
  ShapeSpec,
  SpecAnchor,
  SpecPrimitive,
  SpecStyle,
  Theme,
  VisualState,
} from '@graphloom/core';

/** Cubic approximation constant for quarter arcs (4/3·(√2−1)). */
const K = 0.5522847498307936;

/** {@link statePaint}'s result: a {@link SpecStyle} with the paint trio set. */
export interface StatePaint extends SpecStyle {
  readonly fill: string;
  readonly stroke: string;
  readonly strokeWidth: number;
}

/**
 * The state- and theme-resolved paint of a shape body (P7-T08 visual states):
 * selection beats hover on the stroke; dragging beats locked on opacity.
 */
export function statePaint(node: Node, theme: Theme, state: VisualState): StatePaint {
  const { tokens } = theme;
  const opacity = state.dragging
    ? tokens.draggingOpacity
    : node.locked
      ? tokens.lockedOpacity
      : undefined;
  return {
    fill: tokens.nodeFill,
    stroke: state.selected
      ? tokens.selectionStroke
      : state.hovered
        ? tokens.hoverStroke
        : tokens.nodeStroke,
    strokeWidth: state.selected ? tokens.selectionStrokeWidth : tokens.nodeStrokeWidth,
    ...(opacity !== undefined && { opacity }),
  };
}

/** Default anchors at the bounding-box side midpoints. */
function sideAnchors(w: number, h: number): SpecAnchor[] {
  return [
    { id: 'top', position: { x: w / 2, y: 0 } },
    { id: 'right', position: { x: w, y: h / 2 } },
    { id: 'bottom', position: { x: w / 2, y: h } },
    { id: 'left', position: { x: 0, y: h / 2 } },
  ];
}

function label(node: Node): string {
  const text = node.data['label'];
  return typeof text === 'string' && text !== '' ? text : node.type;
}

type Builder = (
  node: Node,
  theme: Theme,
  state: VisualState,
  s: StatePaint,
  w: number,
  h: number,
) => { children: SpecPrimitive[]; anchors?: SpecAnchor[] };

/** Wraps a geometry builder into a full descriptor with a11y fields. */
function descriptor(role: string, build: Builder): ShapeDescriptor {
  return (node, theme, state): ShapeSpec => {
    const w = node.size.width;
    const h = node.size.height;
    const s = statePaint(node, theme, state);
    const { children, anchors } = build(node, theme, state, s, w, h);
    return { role, label: label(node), children, anchors: anchors ?? sideAnchors(w, h) };
  };
}

/** A quarter-arc cubic from the current point to `to`, bulging via `bulge`. */
function arc(from: Point, to: Point, bulge: Point): PathSegment {
  return {
    kind: 'C',
    c1: { x: from.x + (bulge.x - from.x) * K, y: from.y + (bulge.y - from.y) * K },
    c2: { x: to.x + (bulge.x - to.x) * K, y: to.y + (bulge.y - to.y) * K },
    to,
  };
}

const rectangle = descriptor('node', (_n, _t, _st, s, w, h) => ({
  children: [{ kind: 'rect', x: 0, y: 0, width: w, height: h, style: s }],
}));

const roundedRectangle = descriptor('node', (_n, _t, _st, s, w, h) => ({
  children: [
    { kind: 'roundRect', x: 0, y: 0, width: w, height: h, radius: Math.min(10, w / 2, h / 2), style: s },
  ],
}));

const circle = descriptor('node', (_n, _t, _st, s, w, h) => ({
  children: [{ kind: 'ellipse', cx: w / 2, cy: h / 2, rx: w / 2, ry: h / 2, style: s }],
}));

const diamond = descriptor('decision', (_n, _t, _st, s, w, h) => ({
  children: [
    {
      kind: 'polygon',
      points: [
        { x: w / 2, y: 0 },
        { x: w, y: h / 2 },
        { x: w / 2, y: h },
        { x: 0, y: h / 2 },
      ],
      style: s,
    },
  ],
}));

const triangle = descriptor('node', (_n, _t, _st, s, w, h) => ({
  children: [
    {
      kind: 'polygon',
      points: [
        { x: w / 2, y: 0 },
        { x: w, y: h },
        { x: 0, y: h },
      ],
      style: s,
    },
  ],
  // Dynamic per-shape anchors (P7-T03): east/west sit on the sloped sides,
  // not the bounding box.
  anchors: [
    { id: 'top', position: { x: w / 2, y: 0 } },
    { id: 'right', position: { x: (3 * w) / 4, y: h / 2 } },
    { id: 'bottom', position: { x: w / 2, y: h } },
    { id: 'left', position: { x: w / 4, y: h / 2 } },
  ],
}));

const hexagon = descriptor('node', (_n, _t, _st, s, w, h) => ({
  children: [
    {
      kind: 'polygon',
      points: [
        { x: w / 4, y: 0 },
        { x: (3 * w) / 4, y: 0 },
        { x: w, y: h / 2 },
        { x: (3 * w) / 4, y: h },
        { x: w / 4, y: h },
        { x: 0, y: h / 2 },
      ],
      style: s,
    },
  ],
}));

/** Vertical cylinder: body silhouette plus a lid ellipse in the surface fill. */
const database = descriptor('database', (_n, theme, _st, s, w, h) => {
  const ry = Math.min(h * 0.15, h / 2);
  const body: PathSegment[] = [
    { kind: 'M', to: { x: 0, y: ry } },
    { kind: 'L', to: { x: 0, y: h - ry } },
    arc({ x: 0, y: h - ry }, { x: w / 2, y: h }, { x: 0, y: h }),
    arc({ x: w / 2, y: h }, { x: w, y: h - ry }, { x: w, y: h }),
    { kind: 'L', to: { x: w, y: ry } },
    arc({ x: w, y: ry }, { x: w / 2, y: 0 }, { x: w, y: 0 }),
    arc({ x: w / 2, y: 0 }, { x: 0, y: ry }, { x: 0, y: 0 }),
    { kind: 'Z' },
  ];
  return {
    children: [
      { kind: 'path', segments: body, style: s },
      {
        kind: 'ellipse',
        cx: w / 2,
        cy: ry,
        rx: w / 2,
        ry,
        style: { ...s, fill: theme.tokens.surfaceFill },
      },
    ],
  };
});

/** Horizontal cylinder (message queue). */
const queue = descriptor('queue', (_n, theme, _st, s, w, h) => {
  const rx = Math.min(w * 0.15, w / 2);
  const body: PathSegment[] = [
    { kind: 'M', to: { x: rx, y: 0 } },
    { kind: 'L', to: { x: w - rx, y: 0 } },
    arc({ x: w - rx, y: 0 }, { x: w, y: h / 2 }, { x: w, y: 0 }),
    arc({ x: w, y: h / 2 }, { x: w - rx, y: h }, { x: w, y: h }),
    { kind: 'L', to: { x: rx, y: h } },
    arc({ x: rx, y: h }, { x: 0, y: h / 2 }, { x: 0, y: h }),
    arc({ x: 0, y: h / 2 }, { x: rx, y: 0 }, { x: 0, y: 0 }),
    { kind: 'Z' },
  ];
  return {
    children: [
      { kind: 'path', segments: body, style: s },
      {
        kind: 'ellipse',
        cx: rx,
        cy: h / 2,
        rx,
        ry: h / 2,
        style: { ...s, fill: theme.tokens.surfaceFill },
      },
    ],
  };
});

const cloud = descriptor('node', (_n, _t, _st, s, w, h) => ({
  children: [
    {
      kind: 'path',
      segments: [
        { kind: 'M', to: { x: 0.22 * w, y: 0.75 * h } },
        { kind: 'C', c1: { x: 0.06 * w, y: 0.75 * h }, c2: { x: 0, y: 0.6 * h }, to: { x: 0.12 * w, y: 0.5 * h } },
        { kind: 'C', c1: { x: 0.08 * w, y: 0.3 * h }, c2: { x: 0.28 * w, y: 0.22 * h }, to: { x: 0.38 * w, y: 0.32 * h } },
        { kind: 'C', c1: { x: 0.44 * w, y: 0.12 * h }, c2: { x: 0.72 * w, y: 0.12 * h }, to: { x: 0.78 * w, y: 0.3 * h } },
        { kind: 'C', c1: { x: 0.94 * w, y: 0.28 * h }, c2: { x: w, y: 0.45 * h }, to: { x: 0.92 * w, y: 0.58 * h } },
        { kind: 'C', c1: { x: w, y: 0.7 * h }, c2: { x: 0.9 * w, y: 0.78 * h }, to: { x: 0.78 * w, y: 0.75 * h } },
        { kind: 'Z' },
      ],
      style: s,
    },
  ],
}));

const folder = descriptor('container', (_n, theme, _st, s, w, h) => ({
  children: [
    {
      kind: 'polygon',
      points: [
        { x: 0, y: 0.16 * h },
        { x: 0, y: 0.04 * h },
        { x: 0.34 * w, y: 0.04 * h },
        { x: 0.42 * w, y: 0.16 * h },
      ],
      style: { ...s, fill: theme.tokens.surfaceFill },
    },
    { kind: 'roundRect', x: 0, y: 0.16 * h, width: w, height: 0.84 * h, radius: 3, style: s },
  ],
}));

const documentShape = descriptor('document', (_n, _t, _st, s, w, h) => ({
  children: [
    {
      kind: 'path',
      segments: [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: w, y: 0 } },
        { kind: 'L', to: { x: w, y: 0.82 * h } },
        { kind: 'C', c1: { x: 0.7 * w, y: 0.68 * h }, c2: { x: 0.34 * w, y: 0.98 * h }, to: { x: 0, y: 0.85 * h } },
        { kind: 'Z' },
      ],
      style: s,
    },
  ],
}));

const person = descriptor('person', (_n, _t, _st, s, w, h) => ({
  children: [
    { kind: 'ellipse', cx: w / 2, cy: 0.22 * h, rx: 0.16 * w, ry: 0.18 * h, style: s },
    {
      kind: 'path',
      segments: [
        { kind: 'M', to: { x: 0.12 * w, y: h } },
        { kind: 'C', c1: { x: 0.12 * w, y: 0.55 * h }, c2: { x: 0.3 * w, y: 0.48 * h }, to: { x: 0.5 * w, y: 0.48 * h } },
        { kind: 'C', c1: { x: 0.7 * w, y: 0.48 * h }, c2: { x: 0.88 * w, y: 0.55 * h }, to: { x: 0.88 * w, y: h } },
        { kind: 'Z' },
      ],
      style: s,
    },
  ],
}));

const server = descriptor('server', (_n, theme, _st, s, w, h) => {
  const slot = { ...s, fill: theme.tokens.surfaceFill };
  const led = Math.min(w, h) * 0.05;
  return {
    children: [
      { kind: 'roundRect', x: 0, y: 0, width: w, height: h, radius: 4, style: s },
      { kind: 'rect', x: 0.1 * w, y: 0.16 * h, width: 0.8 * w, height: 0.16 * h, style: slot },
      { kind: 'rect', x: 0.1 * w, y: 0.44 * h, width: 0.8 * w, height: 0.16 * h, style: slot },
      { kind: 'ellipse', cx: 0.16 * w, cy: 0.78 * h, rx: led, ry: led, style: { ...s, fill: s.stroke } },
    ],
  };
});

const api = descriptor('api', (_n, _t, _st, s, w, h) => {
  const glyph: SpecStyle = { fill: 'none', stroke: s.stroke, strokeWidth: s.strokeWidth };
  return {
    children: [
      { kind: 'roundRect', x: 0, y: 0, width: w, height: h, radius: Math.min(8, w / 2, h / 2), style: s },
      {
        kind: 'path',
        segments: [
          { kind: 'M', to: { x: 0.34 * w, y: 0.32 * h } },
          { kind: 'L', to: { x: 0.22 * w, y: 0.5 * h } },
          { kind: 'L', to: { x: 0.34 * w, y: 0.68 * h } },
          { kind: 'M', to: { x: 0.66 * w, y: 0.32 * h } },
          { kind: 'L', to: { x: 0.78 * w, y: 0.5 * h } },
          { kind: 'L', to: { x: 0.66 * w, y: 0.68 * h } },
          { kind: 'M', to: { x: 0.56 * w, y: 0.28 * h } },
          { kind: 'L', to: { x: 0.44 * w, y: 0.72 * h } },
        ],
        style: glyph,
      },
    ],
  };
});

const storage = descriptor('storage', (_n, _t, _st, s, w, h) => {
  const line: SpecStyle = { fill: 'none', stroke: s.stroke, strokeWidth: s.strokeWidth };
  return {
    children: [
      { kind: 'rect', x: 0, y: 0, width: w, height: h, style: s },
      {
        kind: 'path',
        segments: [
          { kind: 'M', to: { x: 0, y: h / 3 } },
          { kind: 'L', to: { x: w, y: h / 3 } },
          { kind: 'M', to: { x: 0, y: (2 * h) / 3 } },
          { kind: 'L', to: { x: w, y: (2 * h) / 3 } },
        ],
        style: line,
      },
    ],
  };
});

const container = descriptor('container', (_n, theme, _st, s, w, h) => ({
  children: [
    {
      kind: 'roundRect',
      x: 0,
      y: 0,
      width: w,
      height: h,
      radius: 3,
      style: { ...s, strokeDasharray: [6, 3] },
    },
    { kind: 'rect', x: 0, y: 0, width: w, height: Math.min(0.18 * h, 24), style: { ...s, fill: theme.tokens.surfaceFill } },
  ],
}));

/** Placeholder for image-like shapes with no source: frame + diagonal cross. */
function placeholder(s: StatePaint, w: number, h: number): SpecPrimitive[] {
  return [
    { kind: 'rect', x: 0, y: 0, width: w, height: h, style: s },
    {
      kind: 'path',
      segments: [
        { kind: 'M', to: { x: 0, y: 0 } },
        { kind: 'L', to: { x: w, y: h } },
        { kind: 'M', to: { x: w, y: 0 } },
        { kind: 'L', to: { x: 0, y: h } },
      ],
      style: { fill: 'none', stroke: s.stroke, strokeWidth: s.strokeWidth },
    },
  ];
}

const image = descriptor('img', (node, _t, _st, s, w, h) => {
  const src = node.data['src'];
  return {
    children:
      typeof src === 'string' && src !== ''
        ? [{ kind: 'image', href: src, x: 0, y: 0, width: w, height: h, style: s }]
        : placeholder(s, w, h),
  };
});

/** Inline SVG ships as an image with a `data:image/svg+xml` href (P7-T01 review). */
const svg = descriptor('img', (node, _t, _st, s, w, h) => {
  const markup = node.data['svg'];
  const href =
    typeof markup === 'string' && markup.trimStart().startsWith('<')
      ? `data:image/svg+xml;utf8,${encodeURIComponent(markup)}`
      : typeof markup === 'string' && markup !== ''
        ? markup
        : null;
  return {
    children: href
      ? [{ kind: 'image', href, x: 0, y: 0, width: w, height: h, style: s }]
      : placeholder(s, w, h),
  };
});

const icon = descriptor('img', (node, _t, _st, s, w, h) => {
  const size = Math.min(w, h) * 0.6;
  return {
    children: [
      { kind: 'roundRect', x: 0, y: 0, width: w, height: h, radius: Math.min(8, w / 2, h / 2), style: s },
      {
        kind: 'icon',
        icon: typeof node.data['icon'] === 'string' ? (node.data['icon'] as string) : 'default',
        x: (w - size) / 2,
        y: (h - size) / 2,
        size,
        style: { fill: 'none', stroke: s.stroke, strokeWidth: s.strokeWidth },
      },
    ],
  };
});

/**
 * The built-in shape library (spec §Shape Library), keyed by node `type`.
 * `default` and `ellipse` are the pre-P7 legacy aliases; `cylinder` aliases
 * `database` per the tracker.
 */
export const builtinShapes: ReadonlyMap<string, ShapeDescriptor> = new Map([
  ['rectangle', rectangle],
  ['default', rectangle],
  ['rounded-rectangle', roundedRectangle],
  ['circle', circle],
  ['ellipse', circle],
  ['diamond', diamond],
  ['triangle', triangle],
  ['hexagon', hexagon],
  ['database', database],
  ['cylinder', database],
  ['queue', queue],
  ['cloud', cloud],
  ['folder', folder],
  ['document', documentShape],
  ['person', person],
  ['server', server],
  ['api', api],
  ['storage', storage],
  ['container', container],
  ['image', image],
  ['svg', svg],
  ['icon', icon],
]);

/**
 * Resolves a node type to its descriptor: host/plugin registry first, then
 * the built-in library, then the rectangle fallback (unknown types must
 * render something rather than vanish).
 */
export function resolveShapeDescriptor(
  type: string,
  registry?: ReadonlyMap<string, ShapeDescriptor>,
): ShapeDescriptor {
  return registry?.get(type) ?? builtinShapes.get(type) ?? rectangle;
}
