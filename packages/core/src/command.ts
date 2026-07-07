import type { Emitter, GraphEventMap } from './events.js';
import { CommandValidationError, LimitExceededError, type LimitKind } from './errors.js';
import type { GraphModel } from './model.js';
import type { AppliedOperation, ChangeSource, Command } from './types.js';

/** Configured graph limits (ADR-0007). `Infinity` opts a limit out. */
export interface GraphLimits {
  /** Maximum node count. Default 500. */
  readonly maxNodes: number;
  /** Maximum edge count. Default 2000. */
  readonly maxEdges: number;
  /** Fraction of a limit at which `limit.warning` fires. Default 0.8. */
  readonly warnAtRatio: number;
}

/** The ADR-0007 defaults: 500 nodes, 2000 edges, warning at 80%. */
export const DEFAULT_LIMITS: GraphLimits = {
  maxNodes: 500,
  maxEdges: 2000,
  warnAtRatio: 0.8,
};

/** Passed to a command's `apply` so it can queue events for the commit flush. */
export interface CommandContext {
  /** Queues a granular event; delivered after the commit succeeds, before `graph.change`. */
  emit<K extends keyof GraphEventMap>(type: K, payload: GraphEventMap[K]): void;
}

/**
 * Implementation of one command type (ADR-0001).
 *
 * Contract for `apply`: it must be atomic — either complete fully or leave
 * the model unchanged when it throws. Do all reads and checks before the
 * first mutation (the built-ins' pattern), or compensate your own partial
 * work before rethrowing. The bus rolls back *prior* commands of a failed
 * transaction, but cannot repair a half-applied `apply`.
 */
export interface CommandDef<P = never> {
  /** Mutates the model. Must be atomic (see interface contract). */
  apply(model: GraphModel, payload: P, ctx: CommandContext): void;
  /** Returns the exact inverse command, computed against the pre-apply model. */
  invert(model: GraphModel, payload: P): Command;
  /**
   * Rejects invalid payloads by throwing {@link CommandValidationError}.
   * Skipped for `history` replays (inverses are exact by construction).
   */
  validate?(model: GraphModel, payload: P): void;
}

/** Options for {@link CommandBus.execute} / {@link CommandBus.transact}. */
export interface ExecuteOptions {
  /** Change origin; `history` bypasses validation and limit checks. Default `command`. */
  readonly source?: ChangeSource;
  /** Coalescing hint: consecutive commits sharing a key may merge into one history entry. */
  readonly coalesceKey?: string;
}

/**
 * Executes commands against the model (ADR-0001): validate → invert → apply,
 * then emit. Transactions are atomic (all-or-nothing) and produce one
 * `graph.change` event; nested transactions flatten into the outermost one.
 * Commands dispatched from event handlers are deferred until the current
 * commit's events finish flushing, preserving event order.
 */
export class CommandBus {
  #model: GraphModel;
  #emitter: Emitter<GraphEventMap>;
  #limits: GraphLimits;
  #defs = new Map<string, CommandDef<never>>();
  #txDepth = 0;
  #ops: AppliedOperation[] = [];
  #events: Array<() => void> = [];
  #flushing = false;
  #pending: Array<() => void> = [];
  #warned: Record<LimitKind, boolean> = { maxNodes: false, maxEdges: false };
  #ctx: CommandContext = {
    emit: (type, payload) => {
      this.#events.push(() => this.#emitter.emit(type, payload));
    },
  };

  constructor(model: GraphModel, emitter: Emitter<GraphEventMap>, limits: GraphLimits) {
    this.#model = model;
    this.#emitter = emitter;
    this.#limits = limits;
  }

  /** The limits this bus enforces (readable at runtime per ADR-0007). */
  get limits(): GraphLimits {
    return this.#limits;
  }

  /** Registers a command type. Throws if the type is already registered. */
  register<P>(type: string, def: CommandDef<P>): void {
    if (this.#defs.has(type)) throw new Error(`command type already registered: ${type}`);
    this.#defs.set(type, def as CommandDef<never>);
  }

  /** Removes a command type (no-op if absent). */
  unregister(type: string): void {
    this.#defs.delete(type);
  }

  /** Whether a command type is registered. */
  has(type: string): boolean {
    return this.#defs.has(type);
  }

  /**
   * Executes one command. Outside a transaction this is its own atomic
   * commit; inside one it joins the enclosing transaction.
   */
  execute(command: Command, options: ExecuteOptions = {}): void {
    if (this.#flushing) {
      this.#pending.push(() => this.execute(command, options));
      return;
    }
    if (this.#txDepth > 0) {
      this.#step(command, options);
      return;
    }
    this.#txDepth = 1;
    try {
      this.#step(command, options);
    } catch (error) {
      this.#txDepth = 0;
      this.#rollback();
      throw error;
    }
    this.#txDepth = 0;
    this.#commit(options);
  }

  /**
   * Runs `fn`, folding every command it executes into one atomic commit and
   * one history entry. If `fn` (or a limit check) throws, everything applied
   * so far is rolled back. Nested calls flatten into the outermost
   * transaction — a swallowed nested failure does not undo its ops.
   */
  transact(fn: () => void, options: ExecuteOptions = {}): void {
    if (this.#flushing) {
      this.#pending.push(() => this.transact(fn, options));
      return;
    }
    this.#txDepth++;
    try {
      fn();
    } catch (error) {
      this.#txDepth--;
      if (this.#txDepth === 0) this.#rollback();
      throw error;
    }
    this.#txDepth--;
    if (this.#txDepth === 0) this.#commit(options);
  }

  #step(command: Command, options: ExecuteOptions): void {
    const def = this.#defs.get(command.type);
    if (!def) throw new CommandValidationError(command.type, 'unknown command type');
    const payload = command.payload as never;
    if (options.source !== 'history') def.validate?.(this.#model, payload);
    const inverse = def.invert(this.#model, payload);
    def.apply(this.#model, payload, this.#ctx);
    this.#ops.push({ command, inverse });
  }

  #rollback(): void {
    const ops = this.#ops;
    this.#ops = [];
    this.#events = [];
    for (let i = ops.length - 1; i >= 0; i--) {
      const inverse = ops[i]!.inverse;
      this.#defs.get(inverse.type)!.apply(this.#model, inverse.payload as never, {
        emit: () => {},
      });
    }
  }

  #commit(options: ExecuteOptions): void {
    const { source = 'command', coalesceKey } = options;
    const ops = this.#ops;
    const events = this.#events;
    this.#ops = [];
    this.#events = [];
    if (ops.length === 0) return;
    if (source !== 'history') this.#checkLimits(ops);
    this.#flushing = true;
    try {
      for (const flush of events) flush();
      this.#emitter.emit('graph.change', {
        operations: ops,
        source,
        ...(coalesceKey !== undefined && { coalesceKey }),
      });
      this.#warn('maxNodes', this.#model.nodeCount, this.#limits.maxNodes);
      this.#warn('maxEdges', this.#model.edgeCount, this.#limits.maxEdges);
    } finally {
      this.#flushing = false;
    }
    while (this.#pending.length > 0) this.#pending.shift()!();
  }

  #checkLimits(ops: AppliedOperation[]): void {
    const counts: Record<LimitKind, [count: number, max: number]> = {
      maxNodes: [this.#model.nodeCount, this.#limits.maxNodes],
      maxEdges: [this.#model.edgeCount, this.#limits.maxEdges],
    };
    for (const limit of ['maxNodes', 'maxEdges'] as const) {
      const [count, max] = counts[limit];
      if (count > max) {
        this.#ops = ops;
        this.#rollback();
        this.#emitter.emit('limit.exceeded', { limit, attempted: count, max });
        throw new LimitExceededError(limit, count, max);
      }
    }
  }

  #warn(limit: LimitKind, count: number, max: number): void {
    const threshold = this.#limits.warnAtRatio * max;
    if (count >= threshold) {
      if (!this.#warned[limit]) {
        this.#warned[limit] = true;
        this.#emitter.emit('limit.warning', { limit, count, max });
      }
    } else {
      this.#warned[limit] = false;
    }
  }
}
