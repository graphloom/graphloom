import { FORMAT_VERSION, SerializationError } from './document.js';

/**
 * One version-to-version step in the migration chain (ADR-0004): a pure
 * function from the older raw envelope shape to the newer one. Steps are
 * chained automatically by {@link createMigrationPipeline} — never call one
 * directly.
 */
export interface MigrationStep {
  /** The `graphloom` version this step reads. */
  readonly from: string;
  /** The `graphloom` version this step produces. */
  readonly to: string;
  /** Transforms a raw (not yet structurally validated) envelope object. */
  migrate(doc: Record<string, unknown>): Record<string, unknown>;
}

/** What {@link createMigrationPipeline}'s `migrate` returns. */
export interface MigrationResult {
  /** The raw envelope, migrated forward to `version`. */
  readonly doc: Record<string, unknown>;
  /** Always {@link FORMAT_VERSION} — the loop only exits once it's reached. */
  readonly version: string;
}

/**
 * Builds a pipeline that walks a raw envelope forward through `steps` (keyed
 * by the version each one reads) until it reaches {@link FORMAT_VERSION}.
 * A document already at the current version passes through untouched. No
 * path to the current version — or a cycle among the steps — rejects with a
 * {@link SerializationError} rather than migrating partially or looping.
 */
export function createMigrationPipeline(steps: readonly MigrationStep[]) {
  const byFrom = new Map(steps.map((step) => [step.from, step] as const));
  return {
    migrate(doc: Record<string, unknown>, version: string): MigrationResult {
      let current = doc;
      let v = version;
      const visited = new Set<string>();
      while (v !== FORMAT_VERSION) {
        if (visited.has(v)) {
          throw new SerializationError(`migration cycle detected at version ${v}`, 'graphloom');
        }
        visited.add(v);
        const step = byFrom.get(v);
        if (!step) {
          throw new SerializationError(
            `unsupported format version ${v}; no migration path to ${FORMAT_VERSION}`,
            'graphloom',
          );
        }
        current = step.migrate(current);
        v = step.to;
      }
      return { doc: current, version: v };
    },
  };
}

/**
 * Registered migration steps, oldest first. Empty today — {@link FORMAT_VERSION}
 * (`1.0`) is both the oldest and current format version. When a new format
 * version ships: add one step here (e.g. `{ from: '1.0', to: '1.1', migrate }`),
 * add a frozen fixture under `fixtures/` for the version(s) the new step
 * reads if one doesn't already exist, and add a permanent test that the
 * fixture still loads. Never edit or remove an existing step or fixture —
 * documents are migrated forward, never written backward (ADR-0004).
 */
export const MIGRATION_STEPS: readonly MigrationStep[] = [];

/** The pipeline {@link deserialize} runs every document through. */
export const migrationPipeline = createMigrationPipeline(MIGRATION_STEPS);
