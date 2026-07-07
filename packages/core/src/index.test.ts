import { expect, it } from 'vitest';
import {
  commands,
  createGraph,
  CommandBus,
  CommandValidationError,
  DEFAULT_LIMITS,
  Emitter,
  GraphModel,
  LimitExceededError,
  PACKAGE_NAME,
  PluginHost,
  createEdge,
  createGroup,
  createNode,
  createRegistries,
  registerBuiltins,
  uuidv7,
} from './index.js';

it('exports its package name (P1 smoke + tree-shake probe contract)', () => {
  expect(PACKAGE_NAME).toBe('@graphloom/core');
});

it('exposes the full public surface through the barrel', () => {
  for (const symbol of [
    commands,
    createGraph,
    CommandBus,
    CommandValidationError,
    DEFAULT_LIMITS,
    Emitter,
    GraphModel,
    LimitExceededError,
    PluginHost,
    createEdge,
    createGroup,
    createNode,
    createRegistries,
    registerBuiltins,
    uuidv7,
  ]) {
    expect(symbol).toBeDefined();
  }
});
