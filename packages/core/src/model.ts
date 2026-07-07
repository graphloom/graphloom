import type { Edge, GraphMeta, Group, Node } from './types.js';

// Dev-mode guard (ADR-0001: reads are frozen views in dev). Read via
// globalThis so core typechecks without Node types (SSR/DOM-free, ADR-0002);
// environments without `process` (plain browsers) count as dev.
const DEV =
  (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env?.[
    'NODE_ENV'
  ] !== 'production';

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.keys(value)) {
      deepFreeze((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

/** Incoming and outgoing edge ids of a node. */
export interface NodeEdges {
  readonly in: readonly string[];
  readonly out: readonly string[];
}

/**
 * Read-only view of the graph state — the surface exposed to hosts and
 * renderers. All mutation goes through commands (ADR-0001); in dev builds
 * every returned object is deeply frozen, so accidental writes throw.
 */
export interface GraphView {
  /** Document metadata. */
  readonly meta: GraphMeta;
  /** Looks a node up by id. */
  getNode(id: string): Node | undefined;
  /** Looks an edge up by id. */
  getEdge(id: string): Edge | undefined;
  /** Looks a group up by id. */
  getGroup(id: string): Group | undefined;
  /** All nodes, in insertion order. */
  nodes(): readonly Node[];
  /** All edges, in insertion order. */
  edges(): readonly Edge[];
  /** All groups, in insertion order. */
  groups(): readonly Group[];
  /** Number of nodes (O(1)). */
  readonly nodeCount: number;
  /** Number of edges (O(1)). */
  readonly edgeCount: number;
  /** Incoming/outgoing edge ids of a node (adjacency index, O(degree)). */
  edgesOf(nodeId: string): NodeEdges;
  /** Ids of the groups a node belongs to (membership index). */
  groupsOf(nodeId: string): readonly string[];
  /** Nodes sorted by paint order: ascending zIndex, ties by id. */
  nodesByZ(): readonly Node[];
}

/**
 * The in-memory graph store: id maps plus derived indexes (adjacency, group
 * membership). Mutator methods keep every index in sync and are for command
 * implementations only — hosts get the {@link GraphView} surface and must
 * never call them directly (ADR-0001: no public mutable API).
 */
export class GraphModel implements GraphView {
  #meta: GraphMeta;
  #nodes = new Map<string, Node>();
  #edges = new Map<string, Edge>();
  #groups = new Map<string, Group>();
  /** nodeId → incoming edge ids. */
  #edgesIn = new Map<string, Set<string>>();
  /** nodeId → outgoing edge ids. */
  #edgesOut = new Map<string, Set<string>>();
  /** nodeId → group ids containing it. */
  #memberOf = new Map<string, Set<string>>();

  constructor(meta: GraphMeta) {
    this.#meta = DEV ? deepFreeze(meta) : meta;
  }

  get meta(): GraphMeta {
    return this.#meta;
  }

  getNode(id: string): Node | undefined {
    return this.#nodes.get(id);
  }

  getEdge(id: string): Edge | undefined {
    return this.#edges.get(id);
  }

  getGroup(id: string): Group | undefined {
    return this.#groups.get(id);
  }

  nodes(): readonly Node[] {
    return [...this.#nodes.values()];
  }

  edges(): readonly Edge[] {
    return [...this.#edges.values()];
  }

  groups(): readonly Group[] {
    return [...this.#groups.values()];
  }

  get nodeCount(): number {
    return this.#nodes.size;
  }

  get edgeCount(): number {
    return this.#edges.size;
  }

  edgesOf(nodeId: string): NodeEdges {
    return {
      in: [...(this.#edgesIn.get(nodeId) ?? [])],
      out: [...(this.#edgesOut.get(nodeId) ?? [])],
    };
  }

  groupsOf(nodeId: string): readonly string[] {
    return [...(this.#memberOf.get(nodeId) ?? [])];
  }

  nodesByZ(): readonly Node[] {
    // ponytail: sort on read; cache behind a dirty flag if profiling ever
    // shows this hot at the 500-node default (it won't).
    return this.nodes()
      .slice()
      .sort((a, b) => a.zIndex - b.zIndex || (a.id < b.id ? -1 : 1));
  }

  // ---- mutators (command implementations only) --------------------------

  /** Replaces document metadata. */
  setMeta(meta: GraphMeta): void {
    this.#meta = DEV ? deepFreeze(meta) : meta;
  }

  /** Inserts a node. Throws if the id already exists. */
  addNode(node: Node): void {
    if (this.#nodes.has(node.id)) throw new Error(`duplicate node id ${node.id}`);
    this.#nodes.set(node.id, DEV ? deepFreeze(node) : node);
  }

  /** Replaces an existing node object (same id). */
  replaceNode(node: Node): void {
    if (!this.#nodes.has(node.id)) throw new Error(`unknown node id ${node.id}`);
    this.#nodes.set(node.id, DEV ? deepFreeze(node) : node);
  }

  /**
   * Removes a node. The caller (the `node.remove` command) must have removed
   * its edges and group memberships first — this throws if any remain, so the
   * cascade can never be forgotten.
   */
  removeNode(id: string): void {
    if (!this.#nodes.has(id)) throw new Error(`unknown node id ${id}`);
    if (this.#edgesIn.get(id)?.size || this.#edgesOut.get(id)?.size) {
      throw new Error(`node ${id} still has edges attached`);
    }
    if (this.#memberOf.get(id)?.size) {
      throw new Error(`node ${id} is still a group member`);
    }
    this.#nodes.delete(id);
    this.#edgesIn.delete(id);
    this.#edgesOut.delete(id);
    this.#memberOf.delete(id);
  }

  /** Inserts an edge and updates the adjacency index. Endpoints must exist. */
  addEdge(edge: Edge): void {
    if (this.#edges.has(edge.id)) throw new Error(`duplicate edge id ${edge.id}`);
    if (!this.#nodes.has(edge.source)) throw new Error(`unknown source node ${edge.source}`);
    if (!this.#nodes.has(edge.target)) throw new Error(`unknown target node ${edge.target}`);
    this.#edges.set(edge.id, DEV ? deepFreeze(edge) : edge);
    this.#index(this.#edgesOut, edge.source).add(edge.id);
    this.#index(this.#edgesIn, edge.target).add(edge.id);
  }

  /** Replaces an existing edge (same id), re-indexing if endpoints changed. */
  replaceEdge(edge: Edge): void {
    const previous = this.#edges.get(edge.id);
    if (!previous) throw new Error(`unknown edge id ${edge.id}`);
    if (!this.#nodes.has(edge.source)) throw new Error(`unknown source node ${edge.source}`);
    if (!this.#nodes.has(edge.target)) throw new Error(`unknown target node ${edge.target}`);
    this.#edgesOut.get(previous.source)?.delete(edge.id);
    this.#edgesIn.get(previous.target)?.delete(edge.id);
    this.#edges.set(edge.id, DEV ? deepFreeze(edge) : edge);
    this.#index(this.#edgesOut, edge.source).add(edge.id);
    this.#index(this.#edgesIn, edge.target).add(edge.id);
  }

  /** Removes an edge and updates the adjacency index. */
  removeEdge(id: string): void {
    const edge = this.#edges.get(id);
    if (!edge) throw new Error(`unknown edge id ${id}`);
    this.#edges.delete(id);
    this.#edgesOut.get(edge.source)?.delete(id);
    this.#edgesIn.get(edge.target)?.delete(id);
  }

  /** Inserts a group and updates the membership index. Members must exist. */
  addGroup(group: Group): void {
    if (this.#groups.has(group.id)) throw new Error(`duplicate group id ${group.id}`);
    for (const member of group.members) {
      if (!this.#nodes.has(member)) throw new Error(`unknown member node ${member}`);
    }
    this.#groups.set(group.id, DEV ? deepFreeze(group) : group);
    for (const member of group.members) this.#index(this.#memberOf, member).add(group.id);
  }

  /** Replaces an existing group (same id), re-indexing membership. */
  replaceGroup(group: Group): void {
    const previous = this.#groups.get(group.id);
    if (!previous) throw new Error(`unknown group id ${group.id}`);
    for (const member of group.members) {
      if (!this.#nodes.has(member)) throw new Error(`unknown member node ${member}`);
    }
    for (const member of previous.members) this.#memberOf.get(member)?.delete(group.id);
    this.#groups.set(group.id, DEV ? deepFreeze(group) : group);
    for (const member of group.members) this.#index(this.#memberOf, member).add(group.id);
  }

  /** Removes a group (members are untouched) and updates the membership index. */
  removeGroup(id: string): void {
    const group = this.#groups.get(id);
    if (!group) throw new Error(`unknown group id ${id}`);
    this.#groups.delete(id);
    for (const member of group.members) this.#memberOf.get(member)?.delete(id);
  }

  #index(map: Map<string, Set<string>>, key: string): Set<string> {
    let set = map.get(key);
    if (!set) {
      set = new Set();
      map.set(key, set);
    }
    return set;
  }
}
