import type { Edge, GraphMeta, Group, JsonValue, Node, Port, Viewport } from '@graphloom/core';
import type { GraphDocument } from './document.js';

// Canonical form: every object's keys in a fixed order, element arrays sorted
// by id, extension keys sorted. Two documents with the same content then
// `JSON.stringify` to the same bytes regardless of how they were built.

// ids are unique (deserialize rejects duplicates), so a total < / >= split is fine
const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

const deepFreeze = <T>(value: T): T => {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
};

const point = (p: { x: number; y: number }): { x: number; y: number } => ({ x: p.x, y: p.y });
const size = (s: { width: number; height: number }): { width: number; height: number } => ({
  width: s.width,
  height: s.height,
});

const canonicalPort = (p: Port): Port => ({
  id: p.id,
  side: p.side,
  offset: p.offset,
  ...(p.visibility !== undefined ? { visibility: p.visibility } : {}),
  data: p.data,
});

const canonicalNode = (n: Node): Node => ({
  id: n.id,
  type: n.type,
  position: point(n.position),
  size: size(n.size),
  rotation: n.rotation,
  zIndex: n.zIndex,
  locked: n.locked,
  hidden: n.hidden,
  ...(n.style !== undefined ? { style: n.style } : {}),
  ports: [...n.ports].map(canonicalPort),
  data: n.data,
});

const canonicalEdge = (e: Edge): Edge => ({
  id: e.id,
  type: e.type,
  source: e.source,
  target: e.target,
  ...(e.sourcePort !== undefined ? { sourcePort: e.sourcePort } : {}),
  ...(e.targetPort !== undefined ? { targetPort: e.targetPort } : {}),
  routing: e.routing,
  labels: [...e.labels].map((l) => ({ text: l.text, position: l.position })),
  zIndex: e.zIndex,
  hidden: e.hidden,
  ...(e.style !== undefined ? { style: e.style } : {}),
  data: e.data,
});

const canonicalGroup = (g: Group): Group => ({
  id: g.id,
  members: [...g.members].sort(),
  collapsed: g.collapsed,
  ...(g.label !== undefined ? { label: g.label } : {}),
  data: g.data,
});

const canonicalMeta = (m: GraphMeta): GraphMeta => ({
  id: m.id,
  name: m.name,
  createdAt: m.createdAt,
  modifiedAt: m.modifiedAt,
});

const canonicalViewport = (v: Viewport): Viewport => ({ x: v.x, y: v.y, zoom: v.zoom });

const canonicalExtensions = (
  ext: Readonly<Record<string, JsonValue>>,
): Record<string, JsonValue> => {
  const out: Record<string, JsonValue> = {};
  for (const key of Object.keys(ext).sort()) out[key] = ext[key] as JsonValue;
  return out;
};

/** The pieces {@link canonicalDocument} assembles into a frozen envelope. */
export interface DocumentParts {
  readonly graphloom: string;
  readonly generator: string;
  readonly metadata: GraphMeta;
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly groups: readonly Group[];
  readonly viewport: Viewport;
  readonly extensions: Readonly<Record<string, JsonValue>>;
}

/** Assembles a deep-frozen, canonically-ordered {@link GraphDocument}. */
export const canonicalDocument = (parts: DocumentParts): GraphDocument =>
  deepFreeze({
    graphloom: parts.graphloom,
    generator: parts.generator,
    metadata: canonicalMeta(parts.metadata),
    graph: {
      nodes: [...parts.nodes].sort(byId).map(canonicalNode),
      edges: [...parts.edges].sort(byId).map(canonicalEdge),
      groups: [...parts.groups].sort(byId).map(canonicalGroup),
    },
    viewport: canonicalViewport(parts.viewport),
    extensions: canonicalExtensions(parts.extensions),
  });

/** Deterministic JSON text for a {@link GraphDocument} (2-space, trailing newline). */
export const stringifyDocument = (doc: GraphDocument): string => `${JSON.stringify(doc, null, 2)}\n`;
