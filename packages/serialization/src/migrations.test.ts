import { describe, expect, it } from 'vitest';
import { SerializationError } from './document.js';
import { createMigrationPipeline, MIGRATION_STEPS, type MigrationStep } from './migrations.js';

describe('createMigrationPipeline', () => {
  it('passes a document already at the current version through untouched', () => {
    const pipeline = createMigrationPipeline([]);
    const doc = { a: 1 };
    const result = pipeline.migrate(doc, '1.0');
    expect(result).toEqual({ doc, version: '1.0' });
    expect(result.doc).toBe(doc); // no copy made on the no-op path
  });

  it('chains multiple steps in order to reach the current version', () => {
    const steps: MigrationStep[] = [
      { from: '0.8', to: '0.9', migrate: (d) => ({ ...d, upgradedFrom08: true }) },
      { from: '0.9', to: '1.0', migrate: (d) => ({ ...d, upgradedFrom09: true }) },
    ];
    const pipeline = createMigrationPipeline(steps);
    const result = pipeline.migrate({ a: 1 }, '0.8');
    expect(result).toEqual({
      doc: { a: 1, upgradedFrom08: true, upgradedFrom09: true },
      version: '1.0',
    });
  });

  it('rejects a version with no registered migration path', () => {
    const pipeline = createMigrationPipeline([]);
    expect(() => pipeline.migrate({}, '0.5')).toThrow(SerializationError);
    try {
      pipeline.migrate({}, '0.5');
    } catch (e) {
      expect((e as SerializationError).path).toBe('graphloom');
    }
  });

  it('detects a migration cycle instead of looping forever', () => {
    const steps: MigrationStep[] = [
      { from: '0.8', to: '0.9', migrate: (d) => d },
      { from: '0.9', to: '0.8', migrate: (d) => d },
    ];
    const pipeline = createMigrationPipeline(steps);
    expect(() => pipeline.migrate({}, '0.8')).toThrow(/cycle/);
  });
});

describe('the real migration registry', () => {
  it('is empty — v1.0 is both the oldest and current format version', () => {
    expect(MIGRATION_STEPS).toEqual([]);
  });
});
