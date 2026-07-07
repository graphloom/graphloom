# GraphLoom

**An enterprise-grade, open-source, framework-agnostic visual graph editor SDK.**

GraphLoom is a shared TypeScript engine for building *any* node-based visual
application — flowcharts, workflow designers, ER diagrams, data lineage, BPMN,
UML, org charts, network topology, mind maps, state machines, dependency
graphs, whiteboards, low-code editors, and more — with first-class Angular and
React wrappers on top of one core.

> **GraphLoom is not a charting library.** It is a graph *editor* SDK: an
> interactive canvas, a typed graph model, an operation-based command system
> with full undo/redo, pluggable renderers (SVG, Canvas), layout engines, and
> a plugin architecture that lets new diagram types be added without touching
> the core.

## Status

🚧 **Pre-alpha.** The architecture is defined and implementation is underway.
Nothing is published for use yet — `@graphloom/core@0.0.0` on npm is a name
reservation.

## Design principles

- **The graph model is the single source of truth.** Rendering is stateless
  and derived; business state never lives in the view.
- **Every action is undoable.** All mutations flow through serializable,
  invertible operations — which also makes autosave, audit trails, and future
  collaboration natural.
- **Framework wrappers contain no business logic.** Angular and React
  packages are thin, idiomatic adapters over the same core.
- **D3 is used for math only** (geometry, curves, layout, quadtrees). It never
  touches the DOM — GraphLoom owns rendering, enforced by lint rules.
- **Plugin-first.** Shapes, commands, validators, layouts, importers, and
  exporters are all registered through one plugin SDK.
- **Accessibility is mandatory.** WCAG AA, keyboard-only editing, and screen
  reader support are architecture requirements, not afterthoughts.

## Planned packages

| Package | Purpose |
| --- | --- |
| `@graphloom/core` | Graph model, commands, events, plugin API |
| `@graphloom/rendering` | Scene graph + SVG/Canvas renderers |
| `@graphloom/interaction` | Pointer/touch/keyboard editing engine |
| `@graphloom/layout` | Tree, layered, force, grid, radial layouts |
| `@graphloom/history` | Undo/redo |
| `@graphloom/clipboard` | Copy/paste/duplicate |
| `@graphloom/serialization` | Versioned document format + migrations |
| `@graphloom/themes` | Design tokens, light/dark/custom themes |
| `@graphloom/angular` | Angular 22 wrapper (standalone, signals, zoneless) |
| `@graphloom/react` | React 19 wrapper (hooks, concurrent-safe) |
| `@graphloom/er`, `@graphloom/charts`, … | Diagram-type plugins |

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports: [SECURITY.md](SECURITY.md).

## License

[MIT](LICENSE)
