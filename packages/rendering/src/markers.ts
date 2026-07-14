// The edge-marker library (P7-T06): built-in arrowheads plus resolution over
// the plugin registry. Marker paths live in a unit box ([-1,1]²) with the
// path end at the origin, pointing +x; the scene places and orients them
// using route tangents (routing.ts), so they sit correctly on every curve.
import type { MarkerSpec } from '@graphloom/core';

const arrow: MarkerSpec = {
  path: [
    { kind: 'M', to: { x: -1, y: -0.5 } },
    { kind: 'L', to: { x: 0, y: 0 } },
    { kind: 'L', to: { x: -1, y: 0.5 } },
    { kind: 'Z' },
  ],
  filled: true,
};

const openArrow: MarkerSpec = {
  path: [
    { kind: 'M', to: { x: -1, y: -0.5 } },
    { kind: 'L', to: { x: 0, y: 0 } },
    { kind: 'L', to: { x: -1, y: 0.5 } },
  ],
  filled: false,
};

const diamond: MarkerSpec = {
  path: [
    { kind: 'M', to: { x: 0, y: 0 } },
    { kind: 'L', to: { x: -0.5, y: -0.35 } },
    { kind: 'L', to: { x: -1, y: 0 } },
    { kind: 'L', to: { x: -0.5, y: 0.35 } },
    { kind: 'Z' },
  ],
  filled: true,
};

/** Circle marker as two half-arc cubics (k = 0.5523 quarter-arc constant). */
const circle: MarkerSpec = {
  path: [
    { kind: 'M', to: { x: 0, y: 0 } },
    { kind: 'C', c1: { x: 0, y: -0.69 }, c2: { x: -1, y: -0.69 }, to: { x: -1, y: 0 } },
    { kind: 'C', c1: { x: -1, y: 0.69 }, c2: { x: 0, y: 0.69 }, to: { x: 0, y: 0 } },
    { kind: 'Z' },
  ],
  filled: true,
};

const bar: MarkerSpec = {
  path: [
    { kind: 'M', to: { x: 0, y: -0.6 } },
    { kind: 'L', to: { x: 0, y: 0.6 } },
  ],
  filled: false,
};

/** Crow's-foot primitive (three prongs; the ER plugin composes it in P12). */
const crowsFoot: MarkerSpec = {
  path: [
    { kind: 'M', to: { x: -1, y: 0 } },
    { kind: 'L', to: { x: 0, y: -0.6 } },
    { kind: 'M', to: { x: -1, y: 0 } },
    { kind: 'L', to: { x: 0, y: 0 } },
    { kind: 'M', to: { x: -1, y: 0 } },
    { kind: 'L', to: { x: 0, y: 0.6 } },
  ],
  filled: false,
};

/** The built-in marker library (P7-T06), keyed by marker name. */
export const builtinMarkers: ReadonlyMap<string, MarkerSpec> = new Map([
  ['arrow', arrow],
  ['open-arrow', openArrow],
  ['diamond', diamond],
  ['circle', circle],
  ['bar', bar],
  ['crows-foot', crowsFoot],
]);

/**
 * Resolves a marker name: host/plugin registry first (custom markers,
 * P7-T06), then the built-in library.
 */
export function resolveMarker(
  name: string,
  registry?: ReadonlyMap<string, MarkerSpec>,
): MarkerSpec | undefined {
  return registry?.get(name) ?? builtinMarkers.get(name);
}
