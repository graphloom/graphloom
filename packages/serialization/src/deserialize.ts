import type {
  Edge,
  EdgeLabel,
  EdgeRouting,
  GraphMeta,
  Group,
  JsonObject,
  JsonValue,
  Node,
  Port,
  PortSide,
  PortVisibility,
  Viewport,
} from '@graphloom/core';
import { canonicalDocument } from './canonical.js';
import {
  DEFAULT_GENERATOR,
  DEFAULT_VIEWPORT,
  SerializationError,
  type GraphDocument,
} from './document.js';
import { migrationPipeline } from './migrations.js';

// ---- primitive assertions (each carries the JSON path to the bad field) ----

const isPlainObject = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const fail = (path: string, message: string): never => {
  throw new SerializationError(message, path);
};

const obj = (v: unknown, path: string): Record<string, unknown> =>
  isPlainObject(v) ? v : fail(path, 'expected an object');

const str = (v: unknown, path: string): string =>
  typeof v === 'string' ? v : fail(path, 'expected a string');

const num = (v: unknown, path: string): number =>
  typeof v === 'number' && Number.isFinite(v) ? v : fail(path, 'expected a finite number');

const bool = (v: unknown, path: string): boolean =>
  typeof v === 'boolean' ? v : fail(path, 'expected a boolean');

const arr = (v: unknown, path: string): unknown[] =>
  Array.isArray(v) ? v : fail(path, 'expected an array');

const enumOf = <T extends string>(v: unknown, path: string, allowed: readonly T[]): T =>
  typeof v === 'string' && (allowed as readonly string[]).includes(v)
    ? (v as T)
    : fail(path, `expected one of ${allowed.join(', ')}`);

const noExtraKeys = (o: Record<string, unknown>, allowed: readonly string[], path: string): void => {
  for (const key of Object.keys(o)) {
    if (!allowed.includes(key)) fail(`${path}.${key}`, 'unknown property');
  }
};

/** Opaque user JSON — must be an object, contents not interpreted (ADR-0004). */
const jsonObject = (v: unknown, path: string): JsonObject => obj(v, path) as JsonObject;

// ---- element validators ---------------------------------------------------

const PORT_SIDES: readonly PortSide[] = ['top', 'right', 'bottom', 'left'];
const PORT_VIS: readonly PortVisibility[] = ['hover', 'always', 'never'];
const ROUTINGS: readonly EdgeRouting[] = ['straight', 'orthogonal', 'bezier', 'smooth'];

const NODE_KEYS = [
  'id', 'type', 'position', 'size', 'rotation', 'zIndex', 'locked', 'hidden', 'style', 'ports', 'data',
] as const;
const PORT_KEYS = ['id', 'side', 'offset', 'visibility', 'data'] as const;
const EDGE_KEYS = [
  'id', 'type', 'source', 'target', 'sourcePort', 'targetPort', 'routing', 'labels', 'zIndex', 'hidden', 'style', 'data',
] as const;
const GROUP_KEYS = ['id', 'members', 'collapsed', 'label', 'data'] as const;
const META_KEYS = ['id', 'name', 'createdAt', 'modifiedAt'] as const;
const VIEWPORT_KEYS = ['x', 'y', 'zoom'] as const;
const ENVELOPE_KEYS = ['graphloom', 'generator', 'metadata', 'graph', 'viewport', 'extensions'] as const;
const GRAPH_KEYS = ['nodes', 'edges', 'groups'] as const;

const point = (v: unknown, path: string): { x: number; y: number } => {
  const o = obj(v, path);
  noExtraKeys(o, ['x', 'y'], path);
  return { x: num(o['x'], `${path}.x`), y: num(o['y'], `${path}.y`) };
};

const sizeOf = (v: unknown, path: string): { width: number; height: number } => {
  const o = obj(v, path);
  noExtraKeys(o, ['width', 'height'], path);
  return { width: num(o['width'], `${path}.width`), height: num(o['height'], `${path}.height`) };
};

const port = (v: unknown, path: string): Port => {
  const o = obj(v, path);
  noExtraKeys(o, PORT_KEYS, path);
  const visibility = o['visibility'];
  return {
    id: str(o['id'], `${path}.id`),
    side: enumOf(o['side'], `${path}.side`, PORT_SIDES),
    offset: num(o['offset'], `${path}.offset`),
    ...(visibility !== undefined
      ? { visibility: enumOf(visibility, `${path}.visibility`, PORT_VIS) }
      : {}),
    data: jsonObject(o['data'], `${path}.data`),
  };
};

const node = (v: unknown, path: string): Node => {
  const o = obj(v, path);
  noExtraKeys(o, NODE_KEYS, path);
  const style = o['style'];
  return {
    id: str(o['id'], `${path}.id`),
    type: str(o['type'], `${path}.type`),
    position: point(o['position'], `${path}.position`),
    size: sizeOf(o['size'], `${path}.size`),
    rotation: num(o['rotation'], `${path}.rotation`),
    zIndex: num(o['zIndex'], `${path}.zIndex`),
    locked: bool(o['locked'], `${path}.locked`),
    hidden: bool(o['hidden'], `${path}.hidden`),
    ...(style !== undefined ? { style: str(style, `${path}.style`) } : {}),
    ports: arr(o['ports'], `${path}.ports`).map((p, i) => port(p, `${path}.ports[${i}]`)),
    data: jsonObject(o['data'], `${path}.data`),
  };
};

const label = (v: unknown, path: string): EdgeLabel => {
  const o = obj(v, path);
  noExtraKeys(o, ['text', 'position'], path);
  return { text: str(o['text'], `${path}.text`), position: num(o['position'], `${path}.position`) };
};

const edge = (v: unknown, path: string): Edge => {
  const o = obj(v, path);
  noExtraKeys(o, EDGE_KEYS, path);
  const sourcePort = o['sourcePort'];
  const targetPort = o['targetPort'];
  const style = o['style'];
  return {
    id: str(o['id'], `${path}.id`),
    type: str(o['type'], `${path}.type`),
    source: str(o['source'], `${path}.source`),
    target: str(o['target'], `${path}.target`),
    ...(sourcePort !== undefined ? { sourcePort: str(sourcePort, `${path}.sourcePort`) } : {}),
    ...(targetPort !== undefined ? { targetPort: str(targetPort, `${path}.targetPort`) } : {}),
    routing: enumOf(o['routing'], `${path}.routing`, ROUTINGS),
    labels: arr(o['labels'], `${path}.labels`).map((l, i) => label(l, `${path}.labels[${i}]`)),
    zIndex: num(o['zIndex'], `${path}.zIndex`),
    hidden: bool(o['hidden'], `${path}.hidden`),
    ...(style !== undefined ? { style: str(style, `${path}.style`) } : {}),
    data: jsonObject(o['data'], `${path}.data`),
  };
};

const group = (v: unknown, path: string): Group => {
  const o = obj(v, path);
  noExtraKeys(o, GROUP_KEYS, path);
  const lbl = o['label'];
  return {
    id: str(o['id'], `${path}.id`),
    members: arr(o['members'], `${path}.members`).map((m, i) => str(m, `${path}.members[${i}]`)),
    collapsed: bool(o['collapsed'], `${path}.collapsed`),
    ...(lbl !== undefined ? { label: str(lbl, `${path}.label`) } : {}),
    data: jsonObject(o['data'], `${path}.data`),
  };
};

const meta = (v: unknown, path: string): GraphMeta => {
  const o = obj(v, path);
  noExtraKeys(o, META_KEYS, path);
  return {
    id: str(o['id'], `${path}.id`),
    name: str(o['name'], `${path}.name`),
    createdAt: str(o['createdAt'], `${path}.createdAt`),
    modifiedAt: str(o['modifiedAt'], `${path}.modifiedAt`),
  };
};

const viewport = (v: unknown, path: string): Viewport => {
  const o = obj(v, path);
  noExtraKeys(o, VIEWPORT_KEYS, path);
  return {
    x: num(o['x'], `${path}.x`),
    y: num(o['y'], `${path}.y`),
    zoom: num(o['zoom'], `${path}.zoom`),
  };
};

// ---- referential integrity ----------------------------------------------

const checkReferences = (nodes: readonly Node[], edges: readonly Edge[], groups: readonly Group[]): void => {
  const seen = new Set<string>();
  const ports = new Map<string, Set<string>>();
  nodes.forEach((n, i) => {
    if (seen.has(n.id)) fail(`graph.nodes[${i}].id`, `duplicate id ${n.id}`);
    seen.add(n.id);
    ports.set(n.id, new Set(n.ports.map((p) => p.id)));
  });
  const edgeIds = new Set<string>();
  edges.forEach((e, i) => {
    if (seen.has(e.id) || edgeIds.has(e.id)) fail(`graph.edges[${i}].id`, `duplicate id ${e.id}`);
    edgeIds.add(e.id);
    if (!ports.has(e.source)) fail(`graph.edges[${i}].source`, `no node ${e.source}`);
    if (!ports.has(e.target)) fail(`graph.edges[${i}].target`, `no node ${e.target}`);
    if (e.sourcePort !== undefined && !ports.get(e.source)!.has(e.sourcePort)) {
      fail(`graph.edges[${i}].sourcePort`, `node ${e.source} has no port ${e.sourcePort}`);
    }
    if (e.targetPort !== undefined && !ports.get(e.target)!.has(e.targetPort)) {
      fail(`graph.edges[${i}].targetPort`, `node ${e.target} has no port ${e.targetPort}`);
    }
  });
  const groupIds = new Set<string>();
  groups.forEach((g, i) => {
    if (groupIds.has(g.id)) fail(`graph.groups[${i}].id`, `duplicate id ${g.id}`);
    groupIds.add(g.id);
    g.members.forEach((m, j) => {
      if (!ports.has(m)) fail(`graph.groups[${i}].members[${j}]`, `no node ${m}`);
    });
  });
};

// ---- entry point -------------------------------------------------------

/**
 * Parses and validates a GraphLoom document (ADR-0004). Accepts JSON text or
 * an already-parsed value. Returns a deep-frozen, canonically-ordered
 * {@link GraphDocument}: re-serializing it is byte-identical. Any malformed
 * field throws a {@link SerializationError} carrying its JSON path — the
 * result is never partial. Unknown `extensions` entries are preserved.
 */
export function deserialize(input: string | unknown): GraphDocument {
  let raw: unknown = input;
  if (typeof input === 'string') {
    try {
      raw = JSON.parse(input);
    } catch (e) {
      throw new SerializationError(`invalid JSON: ${(e as Error).message}`);
    }
  }

  const declared = obj(raw, '$');
  const declaredVersion = str(declared['graphloom'], 'graphloom');
  // Migrate the raw envelope forward to FORMAT_VERSION *before* validating its
  // shape — an older document's shape is exactly what a migration step exists
  // to change, so today's ENVELOPE_KEYS must not be applied to it.
  const { doc: root, version } = migrationPipeline.migrate(declared, declaredVersion);
  noExtraKeys(root, ENVELOPE_KEYS, '$');

  const graph = obj(root['graph'], 'graph');
  noExtraKeys(graph, GRAPH_KEYS, 'graph');
  const nodes = arr(graph['nodes'], 'graph.nodes').map((n, i) => node(n, `graph.nodes[${i}]`));
  const edges = arr(graph['edges'], 'graph.edges').map((e, i) => edge(e, `graph.edges[${i}]`));
  const groups = arr(graph['groups'], 'graph.groups').map((g, i) => group(g, `graph.groups[${i}]`));
  checkReferences(nodes, edges, groups);

  const extensionsRaw = root['extensions'];
  const extensions = extensionsRaw === undefined ? {} : obj(extensionsRaw, 'extensions');

  return canonicalDocument({
    graphloom: version,
    generator:
      root['generator'] === undefined ? DEFAULT_GENERATOR : str(root['generator'], 'generator'),
    metadata: meta(root['metadata'], 'metadata'),
    nodes,
    edges,
    groups,
    viewport:
      root['viewport'] === undefined ? DEFAULT_VIEWPORT : viewport(root['viewport'], 'viewport'),
    extensions: extensions as Readonly<Record<string, JsonValue>>,
  });
}
