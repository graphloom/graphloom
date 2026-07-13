import { describe, expect, it } from 'vitest';
import {
  EMPTY_GRAPH_STATE,
  Graph,
  GraphContext,
  PACKAGE_NAME,
  createGraphStore,
  useGraph,
  useSelection,
  useUndoRedo,
  useViewport,
} from './index.js';

describe('public surface', () => {
  it('exports the component, hooks and store bridge', () => {
    expect(PACKAGE_NAME).toBe('@graphloom/react');
    expect(typeof Graph).toBe('function');
    expect(GraphContext).toBeDefined();
    expect(typeof createGraphStore).toBe('function');
    expect(EMPTY_GRAPH_STATE.nodes).toEqual([]);
    for (const hook of [useGraph, useSelection, useUndoRedo, useViewport]) {
      expect(typeof hook).toBe('function');
    }
  });
});
