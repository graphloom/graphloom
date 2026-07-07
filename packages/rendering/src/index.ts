export {
  almostEqual,
  applyToPoint,
  boundsOfPoints,
  clamp,
  compose,
  cubicBezierPoint,
  distanceToPolyline,
  distanceToSegment,
  flattenCubicBezier,
  polylinePointAt,
  IDENTITY,
  inflateRect,
  invert,
  pointInEllipse,
  pointInRotatedRect,
  rectCenter,
  rectContainsPoint,
  rectContainsRect,
  rectsIntersect,
  rotatedRectBounds,
  rotatedRectCorners,
  rotation,
  rotationAbout,
  scaling,
  segmentIntersectsRect,
  segmentsIntersect,
  translation,
  unionRects,
  type Mat2x3,
  type Rect,
} from './geometry.js';

export {
  createTextMeasurer,
  ellipsize,
  estimateTextSize,
  LINE_HEIGHT,
  wrapText,
  type TextMeasurer,
  type TextStyle,
} from './text.js';
export { hitTestItem, pickTopmost, SpatialIndex, type HitTestOptions } from './spatial.js';
export {
  FrameBuilder,
  type FrameOptions,
  type LodLevel,
  type SceneFrame,
} from './frame.js';
export {
  compareRenderItems,
  DEFAULT_EDGE_STYLE,
  DEFAULT_NODE_STYLE,
  edgeAnchor,
  SceneGraph,
  type PathRenderItem,
  type RenderItem,
  type RenderItemBase,
  type RenderItemId,
  type ResolvedStyle,
  type SceneDirty,
  type SceneElementKind,
  type SceneLayer,
  type SceneOptions,
  type ShapeRenderItem,
  type TextRenderItem,
} from './scene.js';
export { createMockRenderer, hitTestFrame, type Renderer } from './renderer.js';
export {
  createSvgRenderer,
  DEFAULT_GRID,
  type GridConfig,
  type SvgRenderer,
  type SvgRendererOptions,
} from './svg.js';
export { mountRenderer, type MountOptions, type RenderHost } from './host.js';
export {
  rendererConformanceChecks,
  runRendererConformance,
  type ConformanceCheck,
} from './conformance.js';
export {
  ViewportController,
  type ViewportEventMap,
  type ViewportOptions,
} from './viewport.js';

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/rendering';
