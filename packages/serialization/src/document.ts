import type { Edge, GraphMeta, Group, JsonValue, Node, Viewport } from '@graphloom/core';

/**
 * The native format version this package reads and writes (ADR-0004:
 * `major.minor`, independent of package versions). Only `1.0` exists; older
 * docs are migrated forward by the P10-T02 pipeline, never written backward.
 */
export const FORMAT_VERSION = '1.0';

// Kept in sync with package.json — stamped into a fresh document's `generator`.
const PKG_VERSION = '0.0.1';

/** Default `generator` string stamped by {@link serialize}/{@link toDocument}. */
export const DEFAULT_GENERATOR = `@graphloom/serialization@${PKG_VERSION}`;

/** The viewport an untouched document carries when none is supplied. */
export const DEFAULT_VIEWPORT: Viewport = { x: 0, y: 0, zoom: 1 };

/**
 * A GraphLoom document: the ADR-0004 envelope. Element arrays are sorted by
 * id and every object's keys are in a fixed order, so {@link serializeDocument}
 * of a round-tripped document is byte-identical.
 */
export interface GraphDocument {
  /** Format version (`major.minor`). Always {@link FORMAT_VERSION} for documents this package produces. */
  readonly graphloom: string;
  /** Free-form producer tag, e.g. `@graphloom/serialization@0.0.1`. Preserved on round-trip. */
  readonly generator: string;
  /** Document metadata (id/name/timestamps). */
  readonly metadata: GraphMeta;
  /** The graph state: nodes, edges and groups, each array sorted by id. */
  readonly graph: {
    readonly nodes: readonly Node[];
    readonly edges: readonly Edge[];
    readonly groups: readonly Group[];
  };
  /** Persisted viewport (owned by rendering at runtime; opaque pass-through here). */
  readonly viewport: Viewport;
  /**
   * Plugin-owned state, keyed by plugin id (ADR-0004). Unknown entries are
   * preserved verbatim on load/save — a document edited in a leaner install
   * never loses another plugin's data.
   */
  readonly extensions: Readonly<Record<string, JsonValue>>;
}

/** Optional producer-supplied fields for {@link serialize}/{@link toDocument}. */
export interface DocumentExtras {
  /** Viewport to persist; defaults to {@link DEFAULT_VIEWPORT}. */
  readonly viewport?: Viewport;
  /** Plugin state to persist under `extensions`; defaults to `{}`. */
  readonly extensions?: Readonly<Record<string, JsonValue>>;
  /** Overrides the `generator` tag; defaults to {@link DEFAULT_GENERATOR}. */
  readonly generator?: string;
}

/**
 * Thrown when input is not a valid GraphLoom document. Rejection is total —
 * {@link deserialize} never returns a partially-built document and
 * {@link toEditor} never leaves a half-loaded model.
 */
export class SerializationError extends Error {
  /**
   * JSON path to the offending field (`graph.edges[2].target`), or the
   * character position for a JSON syntax error. Absent for whole-input errors.
   */
  readonly path?: string;
  constructor(message: string, path?: string) {
    super(path === undefined ? message : `${path}: ${message}`);
    this.name = 'SerializationError';
    if (path !== undefined) this.path = path;
  }
}
