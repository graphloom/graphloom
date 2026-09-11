import type { GraphEditor } from '@graphloom/core';
import { canonicalDocument, stringifyDocument } from './canonical.js';
import {
  DEFAULT_GENERATOR,
  DEFAULT_VIEWPORT,
  FORMAT_VERSION,
  type DocumentExtras,
  type GraphDocument,
} from './document.js';

/**
 * Builds a canonical {@link GraphDocument} from a live editor's current state
 * plus any producer-supplied `viewport` / `extensions` / `generator`.
 */
export function toDocument(editor: GraphEditor, extras: DocumentExtras = {}): GraphDocument {
  const snap = editor.snapshot();
  return canonicalDocument({
    graphloom: FORMAT_VERSION,
    generator: extras.generator ?? DEFAULT_GENERATOR,
    metadata: snap.meta,
    nodes: snap.nodes,
    edges: snap.edges,
    groups: snap.groups,
    viewport: extras.viewport ?? DEFAULT_VIEWPORT,
    extensions: extras.extensions ?? {},
  });
}

/** Serializes an editor's state to deterministic document JSON. */
export function serialize(editor: GraphEditor, extras?: DocumentExtras): string {
  return stringifyDocument(toDocument(editor, extras));
}

/** Serializes a {@link GraphDocument} to deterministic JSON (2-space, trailing newline). */
export function serializeDocument(doc: GraphDocument): string {
  return stringifyDocument(doc);
}
