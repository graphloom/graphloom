import type { CommandBus, CommandDef } from './command.js';
import type { ConnectionValidator } from './builtins.js';
import type { Emitter, GraphEventMap } from './events.js';
import type { GraphView } from './model.js';
import type { MarkerSpec, ShapeDescriptor } from './shape.js';
import type { JsonObject } from './types.js';

/**
 * A GraphLoom plugin (spec §Plugin SDK). Everything a plugin registers
 * through its {@link PluginContext} is recorded and automatically reverted on
 * uninstall.
 */
export interface GraphPlugin {
  /** Unique plugin id — also the key for its serialized `extensions` slot (ADR-0004). */
  readonly id: string;
  /** Plugin version (semver string, plugin-owned). */
  readonly version: string;
  /** Ids of plugins that must be installed first. */
  readonly dependencies?: readonly string[];
  /** Called once on install with the plugin's own context. */
  install(ctx: PluginContext): void;
  /** Optional extra teardown; automatic registry cleanup happens regardless. */
  uninstall?(ctx: PluginContext): void;
}

/** A keyed registry slot exposed to plugins; registrations are tracked per plugin. */
export interface PluginRegistry<T> {
  /** Registers a value under a key. Throws if the key is taken. */
  register(key: string, value: T): void;
  /** Removes a key (no-op if absent). */
  unregister(key: string): void;
  /** Looks a value up by key. */
  get(key: string): T | undefined;
  /** All registered keys, in registration order. */
  keys(): readonly string[];
}

/** A declarative toolbar/menu contribution — pure data; hosts render the UI. */
export interface UiContribution {
  /** Where the item goes. */
  readonly kind: 'toolbar' | 'menu';
  /** Host-interpreted item descriptor (label, icon, command to dispatch, …). */
  readonly item: JsonObject;
}

/** An AI action descriptor (spec §AI Ready — interface only in P2, see backlog B-10). */
export interface AiAction {
  /** Human-readable action title. */
  readonly title: string;
  /** What the action does, for AI/host discovery. */
  readonly description: string;
}

/**
 * What a plugin sees during install/uninstall: read access to the graph, the
 * command dispatcher, events, and the extension registries. Shape/layout/
 * importer/exporter descriptors are opaque JSON-ish data until their owning
 * phases (P7/P8/P10) define them.
 */
export interface PluginContext {
  /** Read-only view of the graph model. */
  readonly graph: GraphView;
  /** Dispatches a command through the bus (same path as the host). */
  readonly execute: CommandBus['execute'];
  /** Subscribes to editor events; auto-unsubscribed on uninstall. */
  on<K extends keyof GraphEventMap>(
    type: K,
    handler: (payload: GraphEventMap[K]) => void,
  ): () => void;
  /** Custom command types (ADR-0001 plugin vocabulary). */
  readonly commands: {
    /** Registers a command type on the bus; reverted on uninstall. */
    register<P>(type: string, def: CommandDef<P>): void;
    /** Removes a command type this plugin registered. */
    unregister(type: string): void;
  };
  /** Connection validators consulted by `edge.add` (P2-T09). */
  readonly validators: PluginRegistry<ConnectionValidator>;
  /** Tier-1 shape descriptors, keyed by node `type` (ADR-0003, P7). */
  readonly shapes: PluginRegistry<ShapeDescriptor>;
  /** Edge-end marker definitions, keyed by marker name (P7-T06). */
  readonly markers: PluginRegistry<MarkerSpec>;
  /** Layout algorithms (consumed from P8). */
  readonly layouts: PluginRegistry<unknown>;
  /** Document importers (consumed from P10). */
  readonly importers: PluginRegistry<unknown>;
  /** Document exporters (consumed from P10). */
  readonly exporters: PluginRegistry<unknown>;
  /** Declarative toolbar/menu contributions. */
  readonly contributions: PluginRegistry<UiContribution>;
  /** AI action descriptors (interface only for now). */
  readonly aiActions: PluginRegistry<AiAction>;
}

/** The registries shared by a host and its plugins; owned by the editor. */
export interface HostRegistries {
  readonly validators: Map<string, ConnectionValidator>;
  readonly shapes: Map<string, ShapeDescriptor>;
  readonly markers: Map<string, MarkerSpec>;
  readonly layouts: Map<string, unknown>;
  readonly importers: Map<string, unknown>;
  readonly exporters: Map<string, unknown>;
  readonly contributions: Map<string, UiContribution>;
  readonly aiActions: Map<string, AiAction>;
}

/** Creates the editor's empty registry set. */
export function createRegistries(): HostRegistries {
  return {
    validators: new Map(),
    shapes: new Map(),
    markers: new Map(),
    layouts: new Map(),
    importers: new Map(),
    exporters: new Map(),
    contributions: new Map(),
    aiActions: new Map(),
  };
}

interface Installed {
  plugin: GraphPlugin;
  ctx: PluginContext;
  /** Reverts every registration/subscription this plugin made, in reverse order. */
  disposers: Array<() => void>;
}

/**
 * Installs and uninstalls plugins with dependency ordering and automatic
 * registration cleanup.
 */
export class PluginHost {
  #bus: CommandBus;
  #emitter: Emitter<GraphEventMap>;
  #graph: GraphView;
  #registries: HostRegistries;
  #installed = new Map<string, Installed>();

  constructor(
    bus: CommandBus,
    emitter: Emitter<GraphEventMap>,
    graph: GraphView,
    registries: HostRegistries,
  ) {
    this.#bus = bus;
    this.#emitter = emitter;
    this.#graph = graph;
    this.#registries = registries;
  }

  /** Ids of currently installed plugins, in install order. */
  installed(): readonly string[] {
    return [...this.#installed.keys()];
  }

  /**
   * Installs plugins in dependency order (deterministic topological sort;
   * ties keep argument order). Throws on double-install, unknown or cyclic
   * dependencies. Emits `plugin.loaded` per plugin.
   */
  use(...plugins: GraphPlugin[]): void {
    for (const plugin of this.#sort(plugins)) this.#install(plugin);
  }

  /**
   * Uninstalls a plugin: runs its `uninstall` hook, then reverts every
   * registration it made. Idempotent — unknown ids are a no-op. Throws if an
   * installed plugin still depends on it.
   */
  unuse(pluginId: string): void {
    const entry = this.#installed.get(pluginId);
    if (!entry) return;
    for (const other of this.#installed.values()) {
      if (other.plugin.dependencies?.includes(pluginId)) {
        throw new Error(`cannot uninstall ${pluginId}: ${other.plugin.id} depends on it`);
      }
    }
    entry.plugin.uninstall?.(entry.ctx);
    for (let i = entry.disposers.length - 1; i >= 0; i--) entry.disposers[i]!();
    this.#installed.delete(pluginId);
  }

  #sort(plugins: GraphPlugin[]): GraphPlugin[] {
    const byId = new Map(plugins.map((p) => [p.id, p]));
    const ordered: GraphPlugin[] = [];
    const state = new Map<string, 'visiting' | 'done'>();
    const visit = (plugin: GraphPlugin): void => {
      const s = state.get(plugin.id);
      if (s === 'done') return;
      if (s === 'visiting') throw new Error(`plugin dependency cycle involving ${plugin.id}`);
      state.set(plugin.id, 'visiting');
      for (const dep of plugin.dependencies ?? []) {
        if (this.#installed.has(dep)) continue;
        const depPlugin = byId.get(dep);
        if (!depPlugin) throw new Error(`plugin ${plugin.id} depends on missing plugin ${dep}`);
        visit(depPlugin);
      }
      state.set(plugin.id, 'done');
      ordered.push(plugin);
    };
    for (const plugin of plugins) visit(plugin);
    return ordered;
  }

  #install(plugin: GraphPlugin): void {
    if (this.#installed.has(plugin.id)) {
      throw new Error(`plugin already installed: ${plugin.id}`);
    }
    const disposers: Array<() => void> = [];
    const track = <T>(map: Map<string, T>, prefixOwner: string): PluginRegistry<T> => ({
      register: (key, value) => {
        if (map.has(key)) throw new Error(`${prefixOwner}: key already registered: ${key}`);
        map.set(key, value);
        disposers.push(() => map.delete(key));
      },
      unregister: (key) => {
        map.delete(key);
      },
      get: (key) => map.get(key),
      keys: () => [...map.keys()],
    });
    const bus = this.#bus;
    const ctx: PluginContext = {
      graph: this.#graph,
      execute: (command, options) => bus.execute(command, options),
      on: (type, handler) => {
        const off = this.#emitter.on(type, handler);
        disposers.push(off);
        return off;
      },
      commands: {
        register: (type, def) => {
          bus.register(type, def);
          disposers.push(() => bus.unregister(type));
        },
        unregister: (type) => bus.unregister(type),
      },
      validators: track(this.#registries.validators, plugin.id),
      shapes: track(this.#registries.shapes, plugin.id),
      markers: track(this.#registries.markers, plugin.id),
      layouts: track(this.#registries.layouts, plugin.id),
      importers: track(this.#registries.importers, plugin.id),
      exporters: track(this.#registries.exporters, plugin.id),
      contributions: track(this.#registries.contributions, plugin.id),
      aiActions: track(this.#registries.aiActions, plugin.id),
    };
    plugin.install(ctx);
    this.#installed.set(plugin.id, { plugin, ctx, disposers });
    this.#emitter.emit('plugin.loaded', { pluginId: plugin.id, version: plugin.version });
  }
}
