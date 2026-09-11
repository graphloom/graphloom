import { commands, createGraph, type GraphEditor, type GraphLimits } from '@graphloom/core';
import { SerializationError, type GraphDocument } from './document.js';

/** Options for {@link toEditor}. */
export interface ToEditorOptions {
  /** Graph limits for the new editor (ADR-0007); missing fields take the defaults. */
  readonly limits?: Partial<GraphLimits>;
}

/**
 * Builds a fresh {@link GraphEditor} from a validated {@link GraphDocument}.
 * ADR-0007 limits are checked against the document's element counts *before*
 * any command runs, and the nodes/edges/groups are replayed in one atomic
 * transaction — so this never returns a half-loaded model. The document's
 * `viewport` and `extensions` stay on the document for the caller to apply.
 */
export function toEditor(doc: GraphDocument, options: ToEditorOptions = {}): GraphEditor {
  const editor = createGraph({
    meta: doc.metadata,
    ...(options.limits !== undefined ? { limits: options.limits } : {}),
  });

  const { maxNodes, maxEdges } = editor.limits;
  if (doc.graph.nodes.length > maxNodes) {
    throw new SerializationError(
      `document has ${doc.graph.nodes.length} nodes, limit is ${maxNodes}`,
      'graph.nodes',
    );
  }
  if (doc.graph.edges.length > maxEdges) {
    throw new SerializationError(
      `document has ${doc.graph.edges.length} edges, limit is ${maxEdges}`,
      'graph.edges',
    );
  }

  editor.transact(() => {
    for (const node of doc.graph.nodes) editor.execute(commands.nodeAdd(node));
    for (const edge of doc.graph.edges) editor.execute(commands.edgeAdd(edge));
    for (const group of doc.graph.groups) editor.execute(commands.groupCreate(group));
  });

  return editor;
}
