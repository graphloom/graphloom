import { Directive, TemplateRef, inject, input } from '@angular/core';
import type { Node } from '@graphloom/core';

/** Template context for a Tier-2 overlay node template (ADR-0003). */
export interface GraphNodeTemplateContext {
  /** The model node this overlay instance renders. */
  readonly $implicit: Node;
}

/**
 * Declares an `ng-template` as the Tier-2 overlay renderer for one node
 * `type` (ADR-0003 escape hatch). Projected into `<graphloom-graph>`:
 *
 * ```html
 * <graphloom-graph>
 *   <ng-template graphloomNode="card" let-node>{{ node.data?.title }}</ng-template>
 * </graphloom-graph>
 * ```
 *
 * The component stamps the template into an HTML overlay layer above the
 * canvas, positions it from core viewport math, and virtualizes it: only
 * nodes intersecting the viewport (plus margin) are mounted.
 */
@Directive({ selector: 'ng-template[graphloomNode]' })
export class GraphNodeTemplateDirective {
  /** The node `type` this template renders. */
  readonly nodeType = input.required<string>({ alias: 'graphloomNode' });

  /** The projected template, stamped once per visible node of the type. */
  readonly template = inject<TemplateRef<GraphNodeTemplateContext>>(TemplateRef);

  /** Types `let-node` bindings as {@link Node} for consumers' templates. */
  static ngTemplateContextGuard(
    _directive: GraphNodeTemplateDirective,
    // eslint-disable-next-line @typescript-eslint/no-unused-vars -- exists only for the type predicate
    _context: unknown,
  ): _context is GraphNodeTemplateContext {
    return true;
  }
}
