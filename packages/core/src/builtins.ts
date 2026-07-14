import type { CommandBus } from './command.js';
import { CommandValidationError } from './errors.js';
import type { GraphView } from './model.js';
import { uuidv7 } from './id.js';
import type {
  Command,
  Edge,
  EdgeLabel,
  EdgeRouting,
  GraphMeta,
  Group,
  JsonObject,
  Node,
  Point,
  PortSide,
  PortVisibility,
  Size,
} from './types.js';

/**
 * A connection constraint (spec §Property System validation hooks). Consulted
 * by `edge.add` validation; return `true` to allow the edge or a reason
 * string to reject it (surfaced as a {@link CommandValidationError}).
 */
export type ConnectionValidator = (model: GraphView, edge: Edge) => true | string;

/** Input for {@link createNode}: everything optional, defaults filled in. */
export interface NodeInit {
  /** Explicit id; a UUIDv7 is generated when omitted (ADR-0004). */
  readonly id?: string;
  readonly type?: string;
  readonly position?: Point;
  readonly size?: Size;
  readonly rotation?: number;
  readonly zIndex?: number;
  readonly locked?: boolean;
  readonly hidden?: boolean;
  readonly style?: string;
  readonly ports?: readonly PortInit[];
  readonly data?: JsonObject;
}

/** Input for a port on {@link NodeInit}. */
export interface PortInit {
  readonly id: string;
  readonly side?: PortSide;
  readonly offset?: number;
  readonly visibility?: PortVisibility;
  readonly data?: JsonObject;
}

/** Input for {@link createEdge}: endpoints required, the rest defaulted. */
export interface EdgeInit {
  /** Explicit id; a UUIDv7 is generated when omitted (ADR-0004). */
  readonly id?: string;
  readonly type?: string;
  readonly source: string;
  readonly target: string;
  readonly sourcePort?: string;
  readonly targetPort?: string;
  readonly routing?: EdgeRouting;
  readonly labels?: readonly EdgeLabel[];
  readonly zIndex?: number;
  readonly hidden?: boolean;
  readonly style?: string;
  readonly data?: JsonObject;
}

/** Input for {@link createGroup}: everything optional, defaults filled in. */
export interface GroupInit {
  /** Explicit id; a UUIDv7 is generated when omitted (ADR-0004). */
  readonly id?: string;
  readonly members?: readonly string[];
  readonly collapsed?: boolean;
  readonly label?: string;
  readonly data?: JsonObject;
}

/**
 * Patch for `node.update`. Top-level keys are replaced wholesale — including
 * `data` (no deep merge; see Decision Log). `null` clears the optional
 * `style`. `id` can never change.
 */
export type NodeChanges = Partial<Omit<Node, 'id' | 'style'>> & {
  readonly style?: string | null;
};

/**
 * Patch for `edge.update`. Same replace-per-key semantics as
 * {@link NodeChanges}; `null` clears the optional `style`, `sourcePort` and
 * `targetPort`.
 */
export type EdgeChanges = Partial<
  Omit<Edge, 'id' | 'style' | 'sourcePort' | 'targetPort'>
> & {
  readonly style?: string | null;
  readonly sourcePort?: string | null;
  readonly targetPort?: string | null;
};

/** Patch for `graph.update` — any metadata field except `id`. */
export type MetaChanges = Partial<Omit<GraphMeta, 'id'>>;

function sortIds(ids: readonly string[]): string[] {
  return [...ids].sort();
}

/** Normalizes a {@link NodeInit} into a full {@link Node} with defaults applied. */
export function createNode(init: NodeInit = {}): Node {
  return {
    id: init.id ?? uuidv7(),
    type: init.type ?? 'default',
    position: init.position ?? { x: 0, y: 0 },
    size: init.size ?? { width: 100, height: 40 },
    rotation: init.rotation ?? 0,
    zIndex: init.zIndex ?? 0,
    locked: init.locked ?? false,
    hidden: init.hidden ?? false,
    ...(init.style !== undefined && { style: init.style }),
    ports: (init.ports ?? []).map((p) => ({
      id: p.id,
      side: p.side ?? 'right',
      offset: p.offset ?? 0.5,
      ...(p.visibility !== undefined && { visibility: p.visibility }),
      data: p.data ?? {},
    })),
    data: init.data ?? {},
  };
}

/** Normalizes an {@link EdgeInit} into a full {@link Edge} with defaults applied. */
export function createEdge(init: EdgeInit): Edge {
  return {
    id: init.id ?? uuidv7(),
    type: init.type ?? 'default',
    source: init.source,
    target: init.target,
    ...(init.sourcePort !== undefined && { sourcePort: init.sourcePort }),
    ...(init.targetPort !== undefined && { targetPort: init.targetPort }),
    routing: init.routing ?? 'straight',
    labels: init.labels ?? [],
    zIndex: init.zIndex ?? 0,
    hidden: init.hidden ?? false,
    ...(init.style !== undefined && { style: init.style }),
    data: init.data ?? {},
  };
}

/** Normalizes a {@link GroupInit} into a full {@link Group} (members sorted). */
export function createGroup(init: GroupInit = {}): Group {
  return {
    id: init.id ?? uuidv7(),
    members: sortIds(init.members ?? []),
    collapsed: init.collapsed ?? false,
    ...(init.label !== undefined && { label: init.label }),
    data: init.data ?? {},
  };
}

/**
 * Factories for the built-in commands (ADR-0001 vocabulary). Each returns a
 * plain JSON-serializable {@link Command} ready for `editor.execute`.
 */
export const commands = {
  /** Adds a node (defaults filled via {@link createNode}). */
  nodeAdd(init: NodeInit = {}): Command {
    return { type: 'node.add', payload: { node: createNode(init) } };
  },
  /** Removes a node, cascading its edges and group memberships atomically. */
  nodeRemove(id: string): Command {
    return { type: 'node.remove', payload: { id } };
  },
  /** Patches node properties (see {@link NodeChanges} semantics). */
  nodeUpdate(id: string, changes: NodeChanges): Command {
    return { type: 'node.update', payload: { id, changes } };
  },
  /** Adds an edge (defaults via {@link createEdge}); consults connection validators. */
  edgeAdd(init: EdgeInit): Command {
    return { type: 'edge.add', payload: { edge: createEdge(init) } };
  },
  /** Removes an edge. */
  edgeRemove(id: string): Command {
    return { type: 'edge.remove', payload: { id } };
  },
  /** Patches edge properties (see {@link EdgeChanges} semantics). */
  edgeUpdate(id: string, changes: EdgeChanges): Command {
    return { type: 'edge.update', payload: { id, changes } };
  },
  /** Creates a group (defaults via {@link createGroup}). */
  groupCreate(init: GroupInit = {}): Command {
    return { type: 'group.create', payload: { group: createGroup(init) } };
  },
  /** Dissolves a group; member nodes are untouched. */
  groupDissolve(id: string): Command {
    return { type: 'group.dissolve', payload: { id } };
  },
  /** Adds member nodes to a group. */
  groupAdd(id: string, members: readonly string[]): Command {
    return { type: 'group.add', payload: { id, members: [...members] } };
  },
  /** Removes member nodes from a group. */
  groupRemove(id: string, members: readonly string[]): Command {
    return { type: 'group.remove', payload: { id, members: [...members] } };
  },
  /** Collapses a group (rejected if already collapsed, so inversion is exact). */
  groupCollapse(id: string): Command {
    return { type: 'group.collapse', payload: { id } };
  },
  /** Expands a collapsed group (rejected if not collapsed). */
  groupExpand(id: string): Command {
    return { type: 'group.expand', payload: { id } };
  },
  /** Updates document metadata (see {@link MetaChanges}). */
  graphUpdate(changes: MetaChanges): Command {
    return { type: 'graph.update', payload: { changes } };
  },
  /** Sets the zIndex of a node or edge. */
  zReorder(id: string, zIndex: number): Command {
    return { type: 'z.reorder', payload: { id, zIndex } };
  },
} as const;

// ---- internal payload shapes & helpers -----------------------------------

interface NodeRestorePayload {
  node: Node;
  edges: Edge[];
  memberships: string[];
}

function fail(type: string, message: string): never {
  throw new CommandValidationError(type, message);
}

function need<T>(type: string, value: T | undefined, what: string): T {
  if (value === undefined) fail(type, `unknown ${what}`);
  return value;
}

/** Applies replace-per-key patch semantics; `null` deletes keys in `optional`. */
function patch<T extends object>(
  previous: T,
  changes: Record<string, unknown>,
  optional: ReadonlySet<string>,
): { next: T; keys: string[] } {
  const next = { ...previous } as Record<string, unknown>;
  const keys: string[] = [];
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    keys.push(key);
    if (value === null && optional.has(key)) delete next[key];
    else next[key] = value;
  }
  return { next: next as T, keys };
}

/** Builds the inverse patch: previous values, `null` for previously-absent keys. */
function invertChanges(previous: object, changes: Record<string, unknown>): JsonObject {
  const inverse: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(changes)) {
    if (value === undefined) continue;
    const old = (previous as Record<string, unknown>)[key];
    inverse[key] = old === undefined ? null : old;
  }
  return inverse as JsonObject;
}

function checkPatchKeys(
  type: string,
  changes: Record<string, unknown>,
  allowed: ReadonlySet<string>,
): void {
  for (const key of Object.keys(changes)) {
    if (!allowed.has(key)) fail(type, `unknown or immutable property: ${key}`);
  }
}

const NODE_KEYS = new Set([
  'type',
  'position',
  'size',
  'rotation',
  'zIndex',
  'locked',
  'hidden',
  'style',
  'ports',
  'data',
]);
const NODE_OPTIONAL = new Set(['style']);
const EDGE_KEYS = new Set([
  'type',
  'source',
  'target',
  'sourcePort',
  'targetPort',
  'routing',
  'labels',
  'zIndex',
  'hidden',
  'style',
  'data',
]);
const EDGE_OPTIONAL = new Set(['style', 'sourcePort', 'targetPort']);
const META_KEYS = new Set(['name', 'createdAt', 'modifiedAt']);

function checkPort(type: string, model: GraphView, nodeId: string, portId: string | undefined): void {
  if (portId === undefined) return;
  const node = model.getNode(nodeId);
  if (node && !node.ports.some((p) => p.id === portId)) {
    fail(type, `node ${nodeId} has no port ${portId}`);
  }
}

/**
 * Registers the built-in command set on a bus. `validators` is the live
 * connection-validator registry consulted by `edge.add` (P2-T09).
 */
export function registerBuiltins(
  bus: CommandBus,
  validators: ReadonlyMap<string, ConnectionValidator>,
): void {
  bus.register<{ node: Node }>('node.add', {
    validate(model, { node }) {
      if (model.getNode(node.id)) fail('node.add', `duplicate node id ${node.id}`);
    },
    invert(_model, { node }) {
      return commands.nodeRemove(node.id);
    },
    apply(model, { node }, ctx) {
      model.addNode(node);
      ctx.emit('node.created', { node });
    },
  });

  bus.register<{ id: string }>('node.remove', {
    validate(model, { id }) {
      need('node.remove', model.getNode(id), `node ${id}`);
    },
    invert(model, { id }) {
      const node = need('node.remove', model.getNode(id), `node ${id}`);
      const { in: incoming, out } = model.edgesOf(id);
      const edgeIds = [...new Set([...incoming, ...out])];
      return {
        type: 'node.restore',
        payload: {
          node,
          edges: edgeIds.map((edgeId) => model.getEdge(edgeId)!),
          memberships: [...model.groupsOf(id)],
        } satisfies NodeRestorePayload,
      };
    },
    apply(model, { id }, ctx) {
      const node = model.getNode(id)!;
      const { in: incoming, out } = model.edgesOf(id);
      for (const edgeId of new Set([...incoming, ...out])) {
        const edge = model.getEdge(edgeId)!;
        model.removeEdge(edgeId);
        ctx.emit('edge.deleted', { edge });
      }
      for (const groupId of model.groupsOf(id)) {
        const group = model.getGroup(groupId)!;
        const next: Group = { ...group, members: group.members.filter((m) => m !== id) };
        model.replaceGroup(next);
        ctx.emit('group.updated', { group: next, previous: group });
      }
      model.removeNode(id);
      ctx.emit('node.deleted', { node });
    },
  });

  bus.register<NodeRestorePayload>('node.restore', {
    validate(model, { node }) {
      if (model.getNode(node.id)) fail('node.restore', `duplicate node id ${node.id}`);
    },
    invert(_model, { node }) {
      return commands.nodeRemove(node.id);
    },
    apply(model, { node, edges, memberships }, ctx) {
      model.addNode(node);
      ctx.emit('node.created', { node });
      for (const edge of edges) {
        model.addEdge(edge);
        ctx.emit('edge.created', { edge });
      }
      for (const groupId of memberships) {
        const group = model.getGroup(groupId)!;
        const next: Group = { ...group, members: sortIds([...group.members, node.id]) };
        model.replaceGroup(next);
        ctx.emit('group.updated', { group: next, previous: group });
      }
    },
  });

  bus.register<{ id: string; changes: Record<string, unknown> }>('node.update', {
    validate(model, { id, changes }) {
      need('node.update', model.getNode(id), `node ${id}`);
      checkPatchKeys('node.update', changes, NODE_KEYS);
    },
    invert(model, { id, changes }) {
      const previous = need('node.update', model.getNode(id), `node ${id}`);
      return { type: 'node.update', payload: { id, changes: invertChanges(previous, changes) } };
    },
    apply(model, { id, changes }, ctx) {
      const previous = model.getNode(id)!;
      const { next, keys } = patch(previous, changes, NODE_OPTIONAL);
      model.replaceNode(next);
      ctx.emit('node.updated', { node: next, previous });
      for (const key of keys) {
        ctx.emit('property.changed', {
          target: 'node',
          id,
          path: key,
          previous: (previous as unknown as Record<string, unknown>)[key],
          value: (next as unknown as Record<string, unknown>)[key],
        });
      }
    },
  });

  bus.register<{ edge: Edge }>('edge.add', {
    validate(model, { edge }) {
      if (model.getEdge(edge.id)) fail('edge.add', `duplicate edge id ${edge.id}`);
      need('edge.add', model.getNode(edge.source), `source node ${edge.source}`);
      need('edge.add', model.getNode(edge.target), `target node ${edge.target}`);
      checkPort('edge.add', model, edge.source, edge.sourcePort);
      checkPort('edge.add', model, edge.target, edge.targetPort);
      for (const validator of validators.values()) {
        const verdict = validator(model, edge);
        if (verdict !== true) fail('edge.add', verdict);
      }
    },
    invert(_model, { edge }) {
      return commands.edgeRemove(edge.id);
    },
    apply(model, { edge }, ctx) {
      model.addEdge(edge);
      ctx.emit('edge.created', { edge });
    },
  });

  bus.register<{ id: string }>('edge.remove', {
    validate(model, { id }) {
      need('edge.remove', model.getEdge(id), `edge ${id}`);
    },
    invert(model, { id }) {
      const edge = need('edge.remove', model.getEdge(id), `edge ${id}`);
      return { type: 'edge.add', payload: { edge } };
    },
    apply(model, { id }, ctx) {
      const edge = model.getEdge(id)!;
      model.removeEdge(id);
      ctx.emit('edge.deleted', { edge });
    },
  });

  bus.register<{ id: string; changes: Record<string, unknown> }>('edge.update', {
    validate(model, { id, changes }) {
      const previous = need('edge.update', model.getEdge(id), `edge ${id}`);
      checkPatchKeys('edge.update', changes, EDGE_KEYS);
      const source = (changes['source'] as string | undefined) ?? previous.source;
      const target = (changes['target'] as string | undefined) ?? previous.target;
      need('edge.update', model.getNode(source), `source node ${source}`);
      need('edge.update', model.getNode(target), `target node ${target}`);
    },
    invert(model, { id, changes }) {
      const previous = need('edge.update', model.getEdge(id), `edge ${id}`);
      return { type: 'edge.update', payload: { id, changes: invertChanges(previous, changes) } };
    },
    apply(model, { id, changes }, ctx) {
      const previous = model.getEdge(id)!;
      const { next, keys } = patch(previous, changes, EDGE_OPTIONAL);
      model.replaceEdge(next);
      ctx.emit('edge.updated', { edge: next, previous });
      for (const key of keys) {
        ctx.emit('property.changed', {
          target: 'edge',
          id,
          path: key,
          previous: (previous as unknown as Record<string, unknown>)[key],
          value: (next as unknown as Record<string, unknown>)[key],
        });
      }
    },
  });

  bus.register<{ group: Group }>('group.create', {
    validate(model, { group }) {
      if (model.getGroup(group.id)) fail('group.create', `duplicate group id ${group.id}`);
      if (new Set(group.members).size !== group.members.length) {
        fail('group.create', 'duplicate members');
      }
      for (const member of group.members) {
        need('group.create', model.getNode(member), `member node ${member}`);
      }
    },
    invert(_model, { group }) {
      return commands.groupDissolve(group.id);
    },
    apply(model, { group }, ctx) {
      model.addGroup(group);
      ctx.emit('group.created', { group });
    },
  });

  bus.register<{ id: string }>('group.dissolve', {
    validate(model, { id }) {
      need('group.dissolve', model.getGroup(id), `group ${id}`);
    },
    invert(model, { id }) {
      const group = need('group.dissolve', model.getGroup(id), `group ${id}`);
      return { type: 'group.create', payload: { group } };
    },
    apply(model, { id }, ctx) {
      const group = model.getGroup(id)!;
      model.removeGroup(id);
      ctx.emit('group.deleted', { group });
    },
  });

  bus.register<{ id: string; members: string[] }>('group.add', {
    validate(model, { id, members }) {
      const group = need('group.add', model.getGroup(id), `group ${id}`);
      if (new Set(members).size !== members.length) fail('group.add', 'duplicate members');
      for (const member of members) {
        need('group.add', model.getNode(member), `member node ${member}`);
        if (group.members.includes(member)) {
          fail('group.add', `node ${member} is already a member`);
        }
      }
    },
    invert(_model, { id, members }) {
      return commands.groupRemove(id, members);
    },
    apply(model, { id, members }, ctx) {
      const group = model.getGroup(id)!;
      const next: Group = { ...group, members: sortIds([...group.members, ...members]) };
      model.replaceGroup(next);
      ctx.emit('group.updated', { group: next, previous: group });
    },
  });

  bus.register<{ id: string; members: string[] }>('group.remove', {
    validate(model, { id, members }) {
      const group = need('group.remove', model.getGroup(id), `group ${id}`);
      for (const member of members) {
        if (!group.members.includes(member)) {
          fail('group.remove', `node ${member} is not a member`);
        }
      }
    },
    invert(_model, { id, members }) {
      return commands.groupAdd(id, members);
    },
    apply(model, { id, members }, ctx) {
      const group = model.getGroup(id)!;
      const drop = new Set(members);
      const next: Group = { ...group, members: group.members.filter((m) => !drop.has(m)) };
      model.replaceGroup(next);
      ctx.emit('group.updated', { group: next, previous: group });
    },
  });

  bus.register<{ id: string }>('group.collapse', {
    validate(model, { id }) {
      const group = need('group.collapse', model.getGroup(id), `group ${id}`);
      if (group.collapsed) fail('group.collapse', `group ${id} is already collapsed`);
    },
    invert(_model, { id }) {
      return commands.groupExpand(id);
    },
    apply(model, { id }, ctx) {
      const group = model.getGroup(id)!;
      const next: Group = { ...group, collapsed: true };
      model.replaceGroup(next);
      ctx.emit('group.updated', { group: next, previous: group });
    },
  });

  bus.register<{ id: string }>('group.expand', {
    validate(model, { id }) {
      const group = need('group.expand', model.getGroup(id), `group ${id}`);
      if (!group.collapsed) fail('group.expand', `group ${id} is not collapsed`);
    },
    invert(_model, { id }) {
      return commands.groupCollapse(id);
    },
    apply(model, { id }, ctx) {
      const group = model.getGroup(id)!;
      const next: Group = { ...group, collapsed: false };
      model.replaceGroup(next);
      ctx.emit('group.updated', { group: next, previous: group });
    },
  });

  bus.register<{ changes: Record<string, unknown> }>('graph.update', {
    validate(_model, { changes }) {
      checkPatchKeys('graph.update', changes, META_KEYS);
    },
    invert(model, { changes }) {
      return { type: 'graph.update', payload: { changes: invertChanges(model.meta, changes) } };
    },
    apply(model, { changes }, ctx) {
      const previous = model.meta;
      const { next } = patch(previous, changes, new Set());
      model.setMeta(next);
      ctx.emit('graph.updated', { meta: next, previous });
    },
  });

  bus.register<{ id: string; zIndex: number }>('z.reorder', {
    validate(model, { id }) {
      if (!model.getNode(id) && !model.getEdge(id)) {
        fail('z.reorder', `unknown node or edge ${id}`);
      }
    },
    invert(model, { id }) {
      const zIndex = (model.getNode(id) ?? model.getEdge(id)!).zIndex;
      return commands.zReorder(id, zIndex);
    },
    apply(model, { id, zIndex }, ctx) {
      const node = model.getNode(id);
      if (node) {
        const next: Node = { ...node, zIndex };
        model.replaceNode(next);
        ctx.emit('node.updated', { node: next, previous: node });
        ctx.emit('property.changed', {
          target: 'node',
          id,
          path: 'zIndex',
          previous: node.zIndex,
          value: zIndex,
        });
      } else {
        const previous = model.getEdge(id)!;
        const next: Edge = { ...previous, zIndex };
        model.replaceEdge(next);
        ctx.emit('edge.updated', { edge: next, previous });
        ctx.emit('property.changed', {
          target: 'edge',
          id,
          path: 'zIndex',
          previous: previous.zIndex,
          value: zIndex,
        });
      }
    },
  });
}
