import { registerBuiltins } from './builtins.js';
import { CommandBus, DEFAULT_LIMITS, type ExecuteOptions, type GraphLimits } from './command.js';
import { CommandValidationError } from './errors.js';
import { Emitter, type GraphEventMap, type Unsubscribe } from './events.js';
import { uuidv7 } from './id.js';
import { GraphModel, type GraphView } from './model.js';
import { createRegistries, PluginHost, type GraphPlugin, type HostRegistries } from './plugin.js';
import type { Command, Edge, GraphMeta, Group, Node } from './types.js';

/** Options for {@link createGraph}. */
export interface CreateGraphOptions {
  /** Initial document metadata; missing fields are defaulted. */
  readonly meta?: Partial<GraphMeta>;
  /** Graph limits (ADR-0007); missing fields take the defaults. */
  readonly limits?: Partial<GraphLimits>;
}

/**
 * A canonical, JSON-safe copy of the whole graph state. Element arrays are
 * sorted by id, so two states with the same elements serialize identically
 * regardless of mutation history (see Decision Log).
 */
export interface GraphSnapshot {
  readonly meta: GraphMeta;
  readonly nodes: readonly Node[];
  readonly edges: readonly Edge[];
  readonly groups: readonly Group[];
}

/**
 * The headless graph editor (ADR-0001): a read-only model view plus the
 * command boundary. There is no mutable model API — every change is a
 * {@link Command} through {@link GraphEditor.execute} or
 * {@link GraphEditor.transact}.
 */
export interface GraphEditor {
  /** Read-only view of the graph state (frozen views in dev builds). */
  readonly graph: GraphView;
  /** The enforced limits, readable at runtime (ADR-0007). */
  readonly limits: GraphLimits;
  /** Executes one command as an atomic commit (or joins an open transaction). */
  execute(command: Command, options?: ExecuteOptions): void;
  /** Runs `fn` as one atomic transaction = one history entry (ADR-0001). */
  transact(fn: () => void, options?: ExecuteOptions): void;
  /** Subscribes to a typed editor event; returns an unsubscriber. */
  on<K extends keyof GraphEventMap>(
    type: K,
    handler: (payload: GraphEventMap[K]) => void,
  ): Unsubscribe;
  /** Removes an event subscription. */
  off<K extends keyof GraphEventMap>(
    type: K,
    handler: (payload: GraphEventMap[K]) => void,
  ): void;
  /** Installs plugins in dependency order (spec §Plugin SDK). */
  use(...plugins: GraphPlugin[]): void;
  /** Uninstalls a plugin, reverting everything it registered. Idempotent. */
  unuse(pluginId: string): void;
  /** Ids of installed plugins, in install order. */
  plugins(): readonly string[];
  /**
   * Asks hosts to open an inline label editor (P7-T04): validates the target
   * exists, then emits `label.editRequested`. No model change — hosts commit
   * the edited text themselves via `node.update`/`edge.update`.
   */
  requestLabelEdit(target: 'node' | 'edge', id: string, labelIndex?: number): void;
  /** Extension registries (validators, shapes, layouts, …) shared with plugins. */
  readonly registries: HostRegistries;
  /** Takes a canonical {@link GraphSnapshot} of the current state. */
  snapshot(): GraphSnapshot;
}

function withDefaults<T extends object>(defaults: T, overrides: Partial<T> | undefined): T {
  const merged = { ...defaults };
  for (const [key, value] of Object.entries(overrides ?? {})) {
    if (value !== undefined) (merged as Record<string, unknown>)[key] = value;
  }
  return merged;
}

const byId = (a: { id: string }, b: { id: string }): number => (a.id < b.id ? -1 : 1);

/** Creates a headless graph editor (ADR-0001, ADR-0007). */
export function createGraph(options: CreateGraphOptions = {}): GraphEditor {
  const now = new Date().toISOString();
  const meta = withDefaults<GraphMeta>(
    { id: uuidv7(), name: 'Untitled', createdAt: now, modifiedAt: now },
    options.meta,
  );
  const limits = withDefaults(DEFAULT_LIMITS, options.limits);
  const model = new GraphModel(meta);
  const emitter = new Emitter<GraphEventMap>();
  const bus = new CommandBus(model, emitter, limits);
  const registries = createRegistries();
  registerBuiltins(bus, registries.validators);
  const host = new PluginHost(bus, emitter, model, registries);

  return {
    graph: model,
    limits,
    execute: (command, opts) => bus.execute(command, opts),
    transact: (fn, opts) => bus.transact(fn, opts),
    on: (type, handler) => emitter.on(type, handler),
    off: (type, handler) => emitter.off(type, handler),
    use: (...plugins) => host.use(...plugins),
    unuse: (pluginId) => host.unuse(pluginId),
    plugins: () => host.installed(),
    requestLabelEdit: (target, id, labelIndex) => {
      const element = target === 'node' ? model.getNode(id) : model.getEdge(id);
      if (!element) throw new CommandValidationError('label.edit', `unknown ${target} ${id}`);
      if (labelIndex !== undefined) {
        const edge = model.getEdge(id);
        if (!edge || edge.labels[labelIndex] === undefined) {
          throw new CommandValidationError('label.edit', `no label ${labelIndex} on edge ${id}`);
        }
      }
      emitter.emit('label.editRequested', {
        target,
        id,
        ...(labelIndex !== undefined && { labelIndex }),
      });
    },
    registries,
    snapshot: () =>
      structuredClone({
        meta: model.meta,
        nodes: [...model.nodes()].sort(byId),
        edges: [...model.edges()].sort(byId),
        groups: [...model.groups()].sort(byId),
      }),
  };
}
