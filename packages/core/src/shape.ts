// The ADR-0003 Tier-1 vocabulary: declarative ShapeSpec trees produced by
// pure shape descriptors. This is the most compatibility-sensitive API in the
// SDK (P7-T01) — additions are fine, breaking changes need a version bump and
// an RFC (ADR-0004 rules apply, see SHAPE_SPEC_VERSION).
import type { JsonObject, Node, Point } from './types.js';

/**
 * Version of the ShapeSpec vocabulary (major.minor, ADR-0004 semantics:
 * minor = additive only). It rides the serialization envelope's format
 * version — a document written against vocabulary `1.x` renders on any
 * runtime whose major matches.
 */
export const SHAPE_SPEC_VERSION = '1.0';

/**
 * Design tokens a theme provides (spec §Theming). Descriptors read tokens and
 * bake resolved values into the specs they return, so renderers never resolve
 * tokens themselves (ADR-0002: styles are theme-resolved in the scene graph).
 * Number-valued tokens are world units (px at zoom 1).
 */
export interface ThemeTokens {
  /** Canvas background color. */
  readonly background: string;
  /** Background grid ink. */
  readonly grid: string;
  /** Default node fill. */
  readonly nodeFill: string;
  /** Default node stroke. */
  readonly nodeStroke: string;
  /** Default node stroke width. */
  readonly nodeStrokeWidth: number;
  /** Node label text color. */
  readonly nodeText: string;
  /** Secondary surface fill (document folds, cylinder lids, icon plates). */
  readonly surfaceFill: string;
  /** Font family for all graph text. */
  readonly fontFamily: string;
  /** Node label font size. */
  readonly fontSize: number;
  /** Default edge stroke. */
  readonly edgeStroke: string;
  /** Default edge stroke width. */
  readonly edgeStrokeWidth: number;
  /** Edge label text color. */
  readonly edgeText: string;
  /** Edge label font size. */
  readonly edgeFontSize: number;
  /** Port dot fill. */
  readonly portFill: string;
  /** Port dot stroke. */
  readonly portStroke: string;
  /** Port dot radius. */
  readonly portRadius: number;
  /** Edge marker (arrowhead) ink; usually equals `edgeStroke`. */
  readonly markerFill: string;
  /** Stroke color of selected elements. */
  readonly selectionStroke: string;
  /** Stroke width of selected elements. */
  readonly selectionStrokeWidth: number;
  /** Stroke color of hovered elements. */
  readonly hoverStroke: string;
  /** Opacity applied to locked nodes. */
  readonly lockedOpacity: number;
  /** Opacity applied to nodes while dragged. */
  readonly draggingOpacity: number;
}

/**
 * A named set of design tokens. `@graphloom/themes` ships the built-in light
 * and dark themes plus `createTheme` for custom ones.
 */
export interface Theme {
  /** Theme name (e.g. `light`, `dark`, or a custom key). */
  readonly name: string;
  /** The resolved token values. */
  readonly tokens: ThemeTokens;
}

/**
 * Interaction-derived visual state passed to shape descriptors (P7-T08).
 * `locked`/`hidden` live on the {@link Node} itself; collapsed-group
 * visibility is resolved by the scene graph before descriptors run.
 */
export interface VisualState {
  /** Element is in the current selection. */
  readonly selected: boolean;
  /** Pointer is over the element. */
  readonly hovered: boolean;
  /** Element is being dragged (ephemeral preview, ADR-0001). */
  readonly dragging: boolean;
}

/** The at-rest visual state (nothing selected/hovered/dragging). */
export const DEFAULT_VISUAL_STATE: VisualState = {
  selected: false,
  hovered: false,
  dragging: false,
};

/** Paint style of a spec primitive. Unset fields inherit renderer defaults. */
export interface SpecStyle {
  /** Fill color (`none` for hollow shapes). */
  readonly fill?: string;
  /** Stroke color. */
  readonly stroke?: string;
  /** Stroke width in world units. */
  readonly strokeWidth?: number;
  /** Dash pattern in world units (omit for solid). */
  readonly strokeDasharray?: readonly number[];
  /** Opacity 0..1 (multiplies with ancestors). */
  readonly opacity?: number;
}

/** Text-specific style of a `text` primitive. */
export interface SpecTextStyle {
  /** Text color. */
  readonly color?: string;
  /** Font family. */
  readonly fontFamily?: string;
  /** Font size in world units. */
  readonly fontSize?: number;
  /** Bold text. */
  readonly bold?: boolean;
}

/**
 * One segment of a `path` primitive. Structured (not an SVG `d` string) so
 * hit tests, culling and the Canvas backend consume it without a parser;
 * arcs are approximated with cubics by the descriptor.
 */
export type PathSegment =
  | { readonly kind: 'M'; readonly to: Point }
  | { readonly kind: 'L'; readonly to: Point }
  | { readonly kind: 'C'; readonly c1: Point; readonly c2: Point; readonly to: Point }
  | { readonly kind: 'Q'; readonly c: Point; readonly to: Point }
  | { readonly kind: 'Z' };

/** How a `text` primitive handles overflow beyond `maxWidth`. */
export type TextOverflow = 'none' | 'wrap' | 'ellipsis';

/**
 * A node in the declarative shape tree (ADR-0003 Tier 1). Coordinates are in
 * the owning node's local, unrotated space: `(0,0)` is the node's top-left,
 * `(size.width, size.height)` its bottom-right. The scene graph applies the
 * node transform (position + rotation about the center) when lowering specs
 * into render items, so descriptors never deal with world coordinates.
 */
export type SpecPrimitive =
  | {
      readonly kind: 'rect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'roundRect';
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      /** Corner radius in world units (clamped to half the short side). */
      readonly radius: number;
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'ellipse';
      readonly cx: number;
      readonly cy: number;
      readonly rx: number;
      readonly ry: number;
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'path';
      readonly segments: readonly PathSegment[];
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'polygon';
      /** Vertices (closed implicitly; 3+ points). */
      readonly points: readonly Point[];
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'text';
      readonly text: string;
      /** Center of the laid-out text block. */
      readonly x: number;
      readonly y: number;
      /** Max line width; required for `wrap`/`ellipsis` overflow. */
      readonly maxWidth?: number;
      /** Overflow behavior (default `none`: single line, never cut). */
      readonly overflow?: TextOverflow;
      readonly style?: SpecTextStyle;
    }
  | {
      readonly kind: 'image';
      /** Image URL (`data:` URIs welcome — inline SVG ships this way). */
      readonly href: string;
      readonly x: number;
      readonly y: number;
      readonly width: number;
      readonly height: number;
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'icon';
      /** Icon slot name, resolved by the host/renderer icon registry. */
      readonly icon: string;
      readonly x: number;
      readonly y: number;
      /** Icon box edge length (icons are square). */
      readonly size: number;
      readonly style?: SpecStyle;
    }
  | {
      readonly kind: 'group';
      /** Offset applied to every child. */
      readonly translate?: Point;
      readonly children: readonly SpecPrimitive[];
    };

/**
 * A declarative connection anchor (P7-T03 dynamic per-shape anchors), in the
 * node's local space. When a model {@link import('./types.js').Port} and a
 * spec anchor share an id, the spec anchor wins — that's how non-rectangular
 * shapes put ports on their real outline instead of the bounding box.
 */
export interface SpecAnchor {
  /** Anchor id; matched against edge `sourcePort`/`targetPort`. */
  readonly id: string;
  /** Local-space anchor position. */
  readonly position: Point;
}

/**
 * The declarative shape of one node (ADR-0003 Tier 1): what every backend
 * renders, culls, hit-tests and exports. Accessibility fields are mandatory
 * at the type level (risk R7) — the a11y layer consumes them directly.
 */
export interface ShapeSpec {
  /** Accessible role of the node (e.g. `node`, `decision`, `container`). */
  readonly role: string;
  /** Accessible name; descriptors default it from `node.data.label`/type. */
  readonly label: string;
  /** The shape tree, painted in order (later on top). */
  readonly children: readonly SpecPrimitive[];
  /** Default connection anchors (model ports override by id). */
  readonly anchors?: readonly SpecAnchor[];
}

/**
 * A Tier-1 shape descriptor (ADR-0003): a pure function from node, theme and
 * visual state to a {@link ShapeSpec}. Must be deterministic and side-effect
 * free — the scene graph re-runs it on any of the three inputs changing.
 */
export type ShapeDescriptor = (node: Node, theme: Theme, state: VisualState) => ShapeSpec;

/**
 * An edge-end marker definition (P7-T06): a filled or stroked path in a unit
 * box `[-1, 1] × [-1, 1]`, x pointing along the edge direction with the path
 * end at the origin. Registered via the plugin `markers` registry; pure JSON
 * so plugins can ship custom markers serializably.
 */
export interface MarkerSpec {
  /** Marker outline in the unit box. */
  readonly path: readonly PathSegment[];
  /** Painted filled (`true`) or stroked hollow (`false`). */
  readonly filled: boolean;
  /** Opaque marker metadata (e.g. crow's-foot cardinality tags, P12). */
  readonly data?: JsonObject;
}

const finite = (...values: number[]): boolean => values.every(Number.isFinite);

function validatePrimitive(primitive: SpecPrimitive, at: string, problems: string[]): void {
  switch (primitive.kind) {
    case 'rect':
    case 'roundRect':
      if (!finite(primitive.x, primitive.y, primitive.width, primitive.height)) {
        problems.push(`${at}: non-finite rect geometry`);
      }
      if (primitive.width < 0 || primitive.height < 0) problems.push(`${at}: negative size`);
      if (primitive.kind === 'roundRect' && !(primitive.radius >= 0)) {
        problems.push(`${at}: negative or non-finite radius`);
      }
      break;
    case 'ellipse':
      if (!finite(primitive.cx, primitive.cy, primitive.rx, primitive.ry)) {
        problems.push(`${at}: non-finite ellipse geometry`);
      }
      if (primitive.rx < 0 || primitive.ry < 0) problems.push(`${at}: negative radius`);
      break;
    case 'path': {
      if (primitive.segments.length === 0) problems.push(`${at}: empty path`);
      const first = primitive.segments[0];
      if (first && first.kind !== 'M') problems.push(`${at}: path must start with M`);
      for (const segment of primitive.segments) {
        const points =
          segment.kind === 'Z'
            ? []
            : segment.kind === 'C'
              ? [segment.c1, segment.c2, segment.to]
              : segment.kind === 'Q'
                ? [segment.c, segment.to]
                : [segment.to];
        if (!points.every((p) => finite(p.x, p.y))) {
          problems.push(`${at}: non-finite path segment`);
          break;
        }
      }
      break;
    }
    case 'polygon':
      if (primitive.points.length < 3) problems.push(`${at}: polygon needs 3+ points`);
      if (!primitive.points.every((p) => finite(p.x, p.y))) {
        problems.push(`${at}: non-finite polygon point`);
      }
      break;
    case 'text':
      if (!finite(primitive.x, primitive.y)) problems.push(`${at}: non-finite text position`);
      if (primitive.overflow !== undefined && primitive.overflow !== 'none' && primitive.maxWidth === undefined) {
        problems.push(`${at}: ${primitive.overflow} overflow requires maxWidth`);
      }
      if (primitive.maxWidth !== undefined && !(primitive.maxWidth > 0)) {
        problems.push(`${at}: maxWidth must be positive`);
      }
      break;
    case 'image':
      if (primitive.href === '') problems.push(`${at}: empty image href`);
      if (!finite(primitive.x, primitive.y, primitive.width, primitive.height)) {
        problems.push(`${at}: non-finite image geometry`);
      }
      if (primitive.width < 0 || primitive.height < 0) problems.push(`${at}: negative size`);
      break;
    case 'icon':
      if (primitive.icon === '') problems.push(`${at}: empty icon name`);
      if (!finite(primitive.x, primitive.y, primitive.size)) {
        problems.push(`${at}: non-finite icon geometry`);
      }
      break;
    case 'group':
      if (primitive.translate && !finite(primitive.translate.x, primitive.translate.y)) {
        problems.push(`${at}: non-finite group translate`);
      }
      primitive.children.forEach((child, index) =>
        validatePrimitive(child, `${at}.children[${index}]`, problems),
      );
      break;
  }
}

/**
 * Structural validation of a {@link ShapeSpec}: mandatory a11y fields, finite
 * geometry, well-formed paths/polygons, anchor id uniqueness. Returns a list
 * of problems (empty = valid). Used by renderer-conformance tests and as a
 * dev-time guard for plugin-registered descriptors.
 */
export function validateShapeSpec(spec: ShapeSpec): readonly string[] {
  const problems: string[] = [];
  if (spec.role === '') problems.push('role must not be empty');
  if (spec.label === '') problems.push('label must not be empty');
  if (spec.children.length === 0) problems.push('spec has no primitives');
  spec.children.forEach((child, index) =>
    validatePrimitive(child, `children[${index}]`, problems),
  );
  const anchorIds = new Set<string>();
  for (const anchor of spec.anchors ?? []) {
    if (anchor.id === '') problems.push('anchor id must not be empty');
    if (anchorIds.has(anchor.id)) problems.push(`duplicate anchor id ${anchor.id}`);
    anchorIds.add(anchor.id);
    if (!finite(anchor.position.x, anchor.position.y)) {
      problems.push(`anchor ${anchor.id}: non-finite position`);
    }
  }
  return problems;
}
