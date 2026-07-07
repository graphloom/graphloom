/** A JSON-representable primitive value. */
export type JsonPrimitive = string | number | boolean | null;

/** Any JSON-representable value (spec §Property System: user data is opaque JSON). */
export type JsonValue = JsonPrimitive | readonly JsonValue[] | JsonObject;

/** A JSON object with string keys. */
export interface JsonObject {
  readonly [key: string]: JsonValue;
}

/** A 2D point in graph (world) coordinates. */
export interface Point {
  readonly x: number;
  readonly y: number;
}

/** A 2D size in graph (world) units. */
export interface Size {
  readonly width: number;
  readonly height: number;
}

/** The viewport state persisted with a document (ADR-0004). Owned by rendering from P3 on. */
export interface Viewport {
  readonly x: number;
  readonly y: number;
  readonly zoom: number;
}

/** Which side of a node a port sits on. */
export type PortSide = 'top' | 'right' | 'bottom' | 'left';

/** A connection point on a node. */
export interface Port {
  /** Unique within the owning node. */
  readonly id: string;
  /** Side of the node the port sits on. */
  readonly side: PortSide;
  /** Position along the side, 0..1 from the side's start. */
  readonly offset: number;
  /** Opaque user data. */
  readonly data: JsonObject;
}

/** A graph node. Immutable — all changes go through commands (ADR-0001). */
export interface Node {
  readonly id: string;
  /** Shape/behavior type key (resolved by the shape registry from P7). */
  readonly type: string;
  readonly position: Point;
  readonly size: Size;
  /** Rotation in degrees, clockwise. */
  readonly rotation: number;
  /** Paint order; higher renders on top. Ties break by id. */
  readonly zIndex: number;
  /** Locked nodes reject interactive edits (enforced by the interaction layer, P4). */
  readonly locked: boolean;
  readonly hidden: boolean;
  /** Optional style reference (theme key, P7). */
  readonly style?: string;
  readonly ports: readonly Port[];
  /** Opaque user data (spec §Property System) — the core never interprets it. */
  readonly data: JsonObject;
}

/** How an edge is routed between its endpoints. */
export type EdgeRouting = 'straight' | 'orthogonal' | 'bezier';

/** A text label positioned along an edge. */
export interface EdgeLabel {
  readonly text: string;
  /** Position along the edge, 0 = source, 1 = target. */
  readonly position: number;
}

/** A graph edge. Immutable — all changes go through commands (ADR-0001). */
export interface Edge {
  readonly id: string;
  /** Edge type key. */
  readonly type: string;
  /** Source node id. */
  readonly source: string;
  /** Target node id. */
  readonly target: string;
  /** Optional port id on the source node. */
  readonly sourcePort?: string;
  /** Optional port id on the target node. */
  readonly targetPort?: string;
  readonly routing: EdgeRouting;
  readonly labels: readonly EdgeLabel[];
  readonly zIndex: number;
  readonly hidden: boolean;
  /** Optional style reference (theme key, P7). */
  readonly style?: string;
  /** Opaque user data. */
  readonly data: JsonObject;
}

/** A named set of nodes. Immutable — all changes go through commands (ADR-0001). */
export interface Group {
  readonly id: string;
  /** Member node ids. Canonically sorted by id so membership is order-insensitive. */
  readonly members: readonly string[];
  readonly collapsed: boolean;
  readonly label?: string;
  /** Opaque user data. */
  readonly data: JsonObject;
}

/**
 * A serializable operation (ADR-0001). Plain JSON data: `structuredClone` /
 * `JSON.stringify` safe, no functions, no class instances.
 */
export interface Command<P = unknown> {
  /** Registered command type key, e.g. `node.add`. */
  readonly type: string;
  readonly payload: P;
}

/** A committed command paired with its recorded inverse (ADR-0001 history unit). */
export interface AppliedOperation {
  readonly command: Command;
  readonly inverse: Command;
}

/**
 * Origin of a change. `history` replays bypass validation and limit checks
 * (tracker P2-T07 policy); `remote` is reserved for future collaboration.
 */
export type ChangeSource = 'command' | 'history' | 'remote';

/** Document metadata (ADR-0004 envelope `metadata`). */
export interface GraphMeta {
  readonly id: string;
  readonly name: string;
  /** ISO-8601 creation timestamp. Never auto-touched by the core (see Decision Log). */
  readonly createdAt: string;
  /** ISO-8601 modification timestamp. Set by hosts/serialization, never auto-touched. */
  readonly modifiedAt: string;
}
