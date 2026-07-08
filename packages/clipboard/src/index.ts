import {
  commands,
  uuidv7,
  type Edge,
  type GraphEditor,
  type Node,
  type Point,
} from '@graphloom/core';

/**
 * A serialized subgraph (P4-T09): plain JSON, so hosts can round-trip it
 * through the native clipboard (`JSON.stringify` → `navigator.clipboard`)
 * for cross-instance paste. When native access is denied, the in-memory
 * clipboard below keeps working — that *is* the graceful fallback.
 */
export interface ClipboardPayload {
  readonly kind: 'graphloom/subgraph';
  readonly version: 1;
  readonly nodes: readonly Node[];
  /** Internal edges only: both endpoints are in `nodes` (edges to non-copied nodes are dropped). */
  readonly edges: readonly Edge[];
}

/** MIME type hosts should use when writing payloads to the native clipboard. */
export const CLIPBOARD_MIME = 'application/x-graphloom+json';

/** Options for {@link createClipboard}. */
export interface ClipboardOptions {
  /** World offset applied per paste generation (cascades). Default 20,20. */
  readonly pasteOffset?: Point;
}

/** Copy/paste/duplicate service over the command boundary (ADR-0001). */
export interface Clipboard {
  /** The current in-memory payload (survives native-clipboard denial). */
  readonly current: ClipboardPayload | null;
  /**
   * Captures `ids` as a payload: the referenced nodes plus every edge whose
   * endpoints are both included. Returns null (and keeps the previous
   * payload) when no copyable node is referenced.
   */
  copy(ids: readonly string[]): ClipboardPayload | null;
  /**
   * Pastes a payload (default: the internal one) as **one** transaction:
   * fresh ids with edge endpoints remapped, positions offset — repeated
   * pastes of the same payload cascade. Returns the new element ids
   * (nodes first, then edges). A paste that would exceed graph limits
   * (ADR-0007) rejects atomically with `LimitExceededError`.
   */
  paste(payload?: ClipboardPayload): readonly string[];
  /** Copy+paste of `ids` in one step without touching the clipboard (ctrl+D). */
  duplicate(ids: readonly string[]): readonly string[];
}

/**
 * Parses text from the native clipboard into a payload, or null when it is
 * not one of ours (wrong shape, wrong version — never throws).
 */
export function parseClipboardPayload(text: string): ClipboardPayload | null {
  try {
    const value: unknown = JSON.parse(text);
    if (
      typeof value === 'object' &&
      value !== null &&
      (value as { kind?: unknown }).kind === 'graphloom/subgraph' &&
      (value as { version?: unknown }).version === 1 &&
      Array.isArray((value as { nodes?: unknown }).nodes) &&
      Array.isArray((value as { edges?: unknown }).edges)
    ) {
      return value as ClipboardPayload;
    }
  } catch {
    // not JSON — not ours
  }
  return null;
}

/** Creates the clipboard service for an editor (P4-T09). */
export function createClipboard(editor: GraphEditor, options: ClipboardOptions = {}): Clipboard {
  const offset = options.pasteOffset ?? { x: 20, y: 20 };
  let current: ClipboardPayload | null = null;
  /** Cascade counters, keyed per payload object identity. */
  const generations = new WeakMap<ClipboardPayload, number>();

  const capture = (ids: readonly string[]): ClipboardPayload | null => {
    const nodeIds = new Set<string>();
    const nodes: Node[] = [];
    for (const id of ids) {
      const node = editor.graph.getNode(id);
      if (node && !nodeIds.has(id)) {
        nodeIds.add(id);
        nodes.push(node);
      }
    }
    if (nodes.length === 0) return null;
    // Internal edges: every edge between copied nodes, selected or not;
    // edges reaching outside the copied set are dropped (tracker-documented).
    const edges = editor.graph
      .edges()
      .filter((edge) => nodeIds.has(edge.source) && nodeIds.has(edge.target));
    return structuredClone({ kind: 'graphloom/subgraph', version: 1, nodes, edges } as const);
  };

  const paste = (payload?: ClipboardPayload): readonly string[] => {
    const source = payload ?? current;
    if (!source || source.nodes.length === 0) return [];
    const generation = (generations.get(source) ?? 0) + 1;
    const dx = offset.x * generation;
    const dy = offset.y * generation;
    const idMap = new Map<string, string>(source.nodes.map((n) => [n.id, uuidv7()]));
    const newIds: string[] = [];
    editor.transact(() => {
      for (const node of source.nodes) {
        const id = idMap.get(node.id)!;
        newIds.push(id);
        editor.execute(
          commands.nodeAdd({
            ...structuredClone(node),
            id,
            position: { x: node.position.x + dx, y: node.position.y + dy },
          }),
        );
      }
      for (const edge of source.edges) {
        const id = uuidv7();
        newIds.push(id);
        editor.execute(
          commands.edgeAdd({
            ...structuredClone(edge),
            id,
            source: idMap.get(edge.source)!,
            target: idMap.get(edge.target)!,
          }),
        );
      }
    });
    // Only bump the cascade after the transaction survives limit checks.
    generations.set(source, generation);
    return newIds;
  };

  return {
    get current() {
      return current;
    },
    copy(ids) {
      const payload = capture(ids);
      if (payload) current = payload;
      return payload;
    },
    paste,
    duplicate(ids) {
      const payload = capture(ids);
      return payload ? paste(payload) : [];
    },
  };
}

/** This package's name (kept for the P1 smoke test and tree-shake probe). */
export const PACKAGE_NAME = '@graphloom/clipboard';
