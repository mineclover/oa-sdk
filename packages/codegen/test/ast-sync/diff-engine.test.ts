import { describe, it, expect } from 'vitest';
import { computeEntitySpecDiff } from '../../src/ast-sync/diff-engine.js';
import type { EntitySpec } from '../../src/ast-sync/entity-spec.js';

describe('Diff Engine (computeEntitySpecDiff)', () => {
  const baseSpec: EntitySpec = {
    id: 'user',
    name: 'User',
    kind: 'interface',
    docComment: 'User entity',
    extends: ['BaseModel'],
    properties: {
      id: {
        name: 'id',
        type: 'string',
        docComment: 'Unique ID',
      },
      name: {
        name: 'name',
        type: 'string',
      },
    },
  };

  it('returns empty diffs when EntitySpecs are identical', () => {
    const clone: EntitySpec = JSON.parse(JSON.stringify(baseSpec));
    const diffs = computeEntitySpecDiff(baseSpec, clone);
    expect(diffs).toEqual([]);
  });

  it('detects entity-level property changes', () => {
    const modified: EntitySpec = {
      ...baseSpec,
      name: 'AccountUser',
      kind: 'type-alias',
      docComment: 'Updated doc',
      discriminator: { propertyName: 'kind', value: 'user' },
    };

    const diffs = computeEntitySpecDiff(baseSpec, modified);
    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'update-entity',
        path: 'name',
        oldValue: 'User',
        newValue: 'AccountUser',
      })
    );
    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'update-entity',
        path: 'kind',
        oldValue: 'interface',
        newValue: 'type-alias',
      })
    );
    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'update-doc-comment',
        path: 'docComment',
      })
    );
    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'update-discriminator',
        path: 'discriminator',
      })
    );
  });

  it('detects extends addition and removal', () => {
    const modified: EntitySpec = {
      ...baseSpec,
      extends: ['Timestamped'], // Removed BaseModel, added Timestamped
    };

    const diffs = computeEntitySpecDiff(baseSpec, modified);
    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'remove-extends',
        path: 'extends',
        oldValue: 'BaseModel',
      })
    );
    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'add-extends',
        path: 'extends',
        newValue: 'Timestamped',
      })
    );
  });

  it('detects added, removed, and updated properties', () => {
    const target: EntitySpec = {
      ...baseSpec,
      properties: {
        // id updated
        id: {
          name: 'id',
          type: 'string',
          docComment: 'Primary key',
          constraints: { format: 'uuid' },
        },
        // name removed
        // email added
        email: {
          name: 'email',
          type: 'string',
          optional: true,
          constraints: { email: true },
        },
      },
    };

    const diffs = computeEntitySpecDiff(baseSpec, target);

    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'update-property',
        path: 'properties.id',
        propertyName: 'id',
      })
    );

    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'remove-property',
        path: 'properties.name',
        propertyName: 'name',
      })
    );

    expect(diffs).toContainEqual(
      expect.objectContaining({
        kind: 'add-property',
        path: 'properties.email',
        propertyName: 'email',
      })
    );
  });
});
