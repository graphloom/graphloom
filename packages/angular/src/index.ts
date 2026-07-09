export {
  createGraphSignals,
  type GraphSignals,
  type GraphSignalsDeps,
} from './bridge.js';
export {
  GraphComponent,
  type GraphComponentOptions,
} from './graph.component.js';
export {
  GraphNodeTemplateDirective,
  type GraphNodeTemplateContext,
} from './overlay.js';

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/angular';
