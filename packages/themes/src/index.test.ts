import { describe, expect, it } from 'vitest';
import {
  createTheme,
  darkTheme,
  lightTheme,
  PACKAGE_NAME,
  themeToCssVariables,
} from './index.js';

it('exports its package name', () => {
  expect(PACKAGE_NAME).toBe('@graphloom/themes');
});

describe('built-in themes', () => {
  it('light and dark carry the identical token key set (contract completeness)', () => {
    expect(Object.keys(darkTheme.tokens).sort()).toEqual(Object.keys(lightTheme.tokens).sort());
    expect(lightTheme.name).toBe('light');
    expect(darkTheme.name).toBe('dark');
  });

  it('light theme preserves the pre-P7 rendering defaults (visual-baseline compatibility)', () => {
    // These literals are pinned: they must equal rendering's historical
    // DEFAULT_NODE_STYLE / DEFAULT_EDGE_STYLE / DEFAULT_GRID values.
    expect(lightTheme.tokens.nodeFill).toBe('#e8eefc');
    expect(lightTheme.tokens.nodeStroke).toBe('#3b5bd9');
    expect(lightTheme.tokens.nodeStrokeWidth).toBe(1.5);
    expect(lightTheme.tokens.nodeText).toBe('#1a1f36');
    expect(lightTheme.tokens.fontFamily).toBe('system-ui, sans-serif');
    expect(lightTheme.tokens.fontSize).toBe(12);
    expect(lightTheme.tokens.edgeStroke).toBe('#8892a6');
    expect(lightTheme.tokens.edgeStrokeWidth).toBe(1.5);
    expect(lightTheme.tokens.edgeText).toBe('#4a5268');
    expect(lightTheme.tokens.edgeFontSize).toBe(11);
    expect(lightTheme.tokens.grid).toBe('#d4d9e4');
    expect(lightTheme.tokens.markerFill).toBe('#8892a6');
  });
});

describe('createTheme', () => {
  it('merges overrides over the light base by default', () => {
    const theme = createTheme('brand', { nodeFill: '#123456' });
    expect(theme.name).toBe('brand');
    expect(theme.tokens.nodeFill).toBe('#123456');
    expect(theme.tokens.edgeStroke).toBe(lightTheme.tokens.edgeStroke);
  });

  it('accepts a custom base and ignores undefined overrides', () => {
    const theme = createTheme('midnight', { grid: undefined, nodeText: '#fff' }, darkTheme);
    expect(theme.tokens.grid).toBe(darkTheme.tokens.grid);
    expect(theme.tokens.nodeText).toBe('#fff');
    expect(theme.tokens.background).toBe(darkTheme.tokens.background);
  });

  it('never mutates the base theme', () => {
    const before = { ...lightTheme.tokens };
    createTheme('x', { nodeFill: 'red' });
    expect(lightTheme.tokens).toEqual(before);
  });
});

describe('themeToCssVariables', () => {
  it('kebab-cases token names under the --gl- prefix and stringifies numbers', () => {
    const variables = themeToCssVariables(lightTheme);
    expect(variables['--gl-node-fill']).toBe('#e8eefc');
    expect(variables['--gl-node-stroke-width']).toBe('1.5');
    expect(variables['--gl-selection-stroke']).toBe('#4f46e5');
    expect(Object.keys(variables)).toHaveLength(Object.keys(lightTheme.tokens).length);
    for (const key of Object.keys(variables)) expect(key).toMatch(/^--gl-[a-z-]+$/);
  });
});
