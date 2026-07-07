/** Thrown when a command (or a validator it consults) rejects a mutation. The model is left unchanged. */
export class CommandValidationError extends Error {
  /** The command type that failed validation. */
  readonly commandType: string;
  constructor(commandType: string, message: string) {
    super(`${commandType}: ${message}`);
    this.name = 'CommandValidationError';
    this.commandType = commandType;
  }
}

/** Which configured limit was hit. */
export type LimitKind = 'maxNodes' | 'maxEdges';

/**
 * Thrown when a command or transaction would exceed a configured graph limit
 * (ADR-0007). The rejection is atomic: the model is left exactly as before.
 */
export class LimitExceededError extends Error {
  /** The limit that was exceeded. */
  readonly limit: LimitKind;
  /** The element count the rejected change would have produced. */
  readonly attempted: number;
  /** The configured maximum. */
  readonly max: number;
  constructor(limit: LimitKind, attempted: number, max: number) {
    super(`${limit} exceeded: ${attempted} > ${max}`);
    this.name = 'LimitExceededError';
    this.limit = limit;
    this.attempted = attempted;
    this.max = max;
  }
}
