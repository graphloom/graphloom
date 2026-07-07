export type {
  AppliedOperation,
  ChangeSource,
  Command,
  Edge,
  EdgeLabel,
  EdgeRouting,
  GraphMeta,
  Group,
  JsonObject,
  JsonPrimitive,
  JsonValue,
  Node,
  Point,
  Port,
  PortSide,
  Size,
  Viewport,
} from './types.js';
export { uuidv7 } from './id.js';
export { CommandValidationError, LimitExceededError, type LimitKind } from './errors.js';
export { Emitter, type GraphEventMap, type Unsubscribe } from './events.js';
export { GraphModel, type GraphView, type NodeEdges } from './model.js';
export {
  CommandBus,
  DEFAULT_LIMITS,
  type CommandContext,
  type CommandDef,
  type ExecuteOptions,
  type GraphLimits,
} from './command.js';
export {
  commands,
  createEdge,
  createGroup,
  createNode,
  registerBuiltins,
  type ConnectionValidator,
  type EdgeChanges,
  type EdgeInit,
  type GroupInit,
  type MetaChanges,
  type NodeChanges,
  type NodeInit,
  type PortInit,
} from './builtins.js';
export {
  createRegistries,
  PluginHost,
  type AiAction,
  type GraphPlugin,
  type HostRegistries,
  type PluginContext,
  type PluginRegistry,
  type UiContribution,
} from './plugin.js';
export {
  createGraph,
  type CreateGraphOptions,
  type GraphEditor,
  type GraphSnapshot,
} from './editor.js';

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/core';

// ponytail: exists only so tools/check-treeshake.mjs can prove unused exports
// get dropped from consumer bundles; the probe greps for this exact string.
/** Tree-shaking canary — never import this (see `tools/check-treeshake.mjs`). */
export const TREESHAKE_CANARY = 'CORE_TREESHAKE_CANARY';
