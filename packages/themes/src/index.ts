// The GraphLoom theme engine (P7-T07, spec §Theming): named token sets
// consumed by shape descriptors, plus a CSS-variable projection for host
// chrome. Themes are pure data — switching one re-derives the scene without
// touching the model or history (ADR-0001).
import type { Theme, ThemeTokens } from '@graphloom/core';

/**
 * The built-in light theme. Its node/edge/grid values are byte-identical to
 * the pre-P7 rendering defaults, so adopting the theme engine changed no
 * existing pixel (visual-baseline compatibility).
 */
export const lightTheme: Theme = {
  name: 'light',
  tokens: {
    background: '#ffffff',
    grid: '#d4d9e4',
    nodeFill: '#e8eefc',
    nodeStroke: '#3b5bd9',
    nodeStrokeWidth: 1.5,
    nodeText: '#1a1f36',
    surfaceFill: '#d9e2f8',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 12,
    edgeStroke: '#8892a6',
    edgeStrokeWidth: 1.5,
    edgeText: '#4a5268',
    edgeFontSize: 11,
    portFill: '#ffffff',
    portStroke: '#3b5bd9',
    portRadius: 4,
    markerFill: '#8892a6',
    selectionStroke: '#4f46e5',
    selectionStrokeWidth: 2.5,
    hoverStroke: '#818cf8',
    lockedOpacity: 0.55,
    draggingOpacity: 0.75,
  },
};

/** The built-in dark theme. */
export const darkTheme: Theme = {
  name: 'dark',
  tokens: {
    background: '#0d1117',
    grid: '#242c38',
    nodeFill: '#1e2a4a',
    nodeStroke: '#7a95f0',
    nodeStrokeWidth: 1.5,
    nodeText: '#e6edf3',
    surfaceFill: '#2a3a63',
    fontFamily: 'system-ui, sans-serif',
    fontSize: 12,
    edgeStroke: '#6f7b91',
    edgeStrokeWidth: 1.5,
    edgeText: '#a8b3c7',
    edgeFontSize: 11,
    portFill: '#0d1117',
    portStroke: '#7a95f0',
    portRadius: 4,
    markerFill: '#6f7b91',
    selectionStroke: '#818cf8',
    selectionStrokeWidth: 2.5,
    hoverStroke: '#a5b0fb',
    lockedOpacity: 0.55,
    draggingOpacity: 0.75,
  },
};

/**
 * Creates a custom theme (spec §Theming Theme API): `tokens` overrides are
 * merged over `base` (default: the light theme). Unknown keys are rejected
 * by the {@link ThemeTokens} type; every custom theme is complete by
 * construction.
 */
export function createTheme(
  name: string,
  tokens: { readonly [K in keyof ThemeTokens]?: ThemeTokens[K] | undefined },
  base: Theme = lightTheme,
): Theme {
  const merged = { ...base.tokens } as Record<string, string | number>;
  for (const [key, value] of Object.entries(tokens)) {
    if (value !== undefined) merged[key] = value;
  }
  return { name, tokens: merged as unknown as ThemeTokens };
}

/**
 * Projects a theme onto CSS custom properties (spec §Theming CSS Variables):
 * `nodeFill` → `--gl-node-fill`, numbers stringified unitless (world px).
 * Hosts apply the record to a container element to theme their own chrome
 * alongside the graph; the scene itself consumes tokens directly.
 */
export function themeToCssVariables(theme: Theme): Readonly<Record<string, string>> {
  const variables: Record<string, string> = {};
  for (const [key, value] of Object.entries(theme.tokens)) {
    const kebab = key.replace(/[A-Z]/g, (ch) => `-${ch.toLowerCase()}`);
    variables[`--gl-${kebab}`] = String(value);
  }
  return variables;
}

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/themes';
