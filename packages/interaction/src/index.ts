export {
  GestureRecognizer,
  NO_MODIFIERS,
  type DragGesture,
  type GestureEventMap,
  type GestureOptions,
  type GesturePoint,
  type KeyInput,
  type Modifiers,
  type PinchGesture,
  type PointerInput,
  type PointerKind,
  type WheelInput,
} from './gestures.js';
export { PanZoomController, type PanZoomOptions } from './panzoom.js';
export { Selection, type SelectionEventMap, type SelectMode } from './selection.js';
export {
  DragController,
  type DragControllerOptions,
  type DragEventMap,
  type SnapContext,
  type SnapProvider,
} from './drag.js';
export {
  handlePositions,
  resizeNode,
  rotateNode,
  ROTATION_SNAP_DEGREES,
  TransformController,
  type HandleId,
  type NodeTransform,
  type TransformEventMap,
  type TransformOptions,
} from './transform.js';
export { Snapper, type SnapEventMap, type SnapGuide, type SnapOptions } from './snap.js';
export {
  canConnect,
  ConnectController,
  type ConnectEndpoint,
  type ConnectEventMap,
  type ConnectOptions,
  type ConnectPreview,
} from './connect.js';
export {
  actionFor,
  chordOf,
  contentBounds,
  createShortcutHandler,
  DEFAULT_KEYMAP,
  NUDGE_STEP,
  NUDGE_STEP_BIG,
  type Keymap,
  type ShortcutDeps,
} from './keymap.js';
export {
  buildContextMenuRequest,
  type ContextMenuEntry,
  type ContextMenuRequest,
  type ContextMenuTarget,
  type ContextMenuTargetKind,
} from './contextmenu.js';
export {
  InteractionEngine,
  type EngineEventMap,
  type InteractionEngineDeps,
  type InteractionEngineOptions,
} from './engine.js';
export { attachInteraction, type AttachOptions } from './dom.js';

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/interaction';
