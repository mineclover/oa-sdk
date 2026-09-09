import type { EntitySpec, EntityPropertySpec, ASTDiff, PropertyConstraint } from './entity-spec.js';

function normalizeConstraints(raw?: PropertyConstraint): Record<string, unknown> {
  if (!raw) return {};
  const normalized: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(raw)) {
    if (value === undefined) continue;

    if (key === 'minimum' || key === 'min') {
      normalized['min'] = value;
    } else if (key === 'maximum' || key === 'max') {
      normalized['max'] = value;
    } else if (key === 'uuid' || (key === 'format' && value === 'uuid')) {
      normalized['format'] = 'uuid';
    } else if (key === 'email' || (key === 'format' && value === 'email')) {
      normalized['format'] = 'email';
    } else if (key === 'url' || key === 'uri' || (key === 'format' && (value === 'url' || value === 'uri'))) {
      normalized['format'] = 'uri';
    } else if (key === 'datetime' || (key === 'format' && value === 'date-time')) {
      normalized['format'] = 'date-time';
    } else {
      normalized[key] = value;
    }
  }

  return normalized;
}

function areConstraintsEqual(
  a?: PropertyConstraint,
  b?: PropertyConstraint
): boolean {
  const normA = normalizeConstraints(a);
  const normB = normalizeConstraints(b);

  const keysA = Object.keys(normA).sort();
  const keysB = Object.keys(normB).sort();

  if (keysA.length !== keysB.length) return false;
  for (const k of keysA) {
    if (JSON.stringify(normA[k]) !== JSON.stringify(normB[k])) return false;
  }
  return true;
}

function arePropertiesEqual(a: EntityPropertySpec, b: EntityPropertySpec): boolean {
  if (a.name !== b.name) return false;
  if (a.type !== b.type) return false;
  if (Boolean(a.optional) !== Boolean(b.optional)) return false;
  if (Boolean(a.nullable) !== Boolean(b.nullable)) return false;
  if (a.docComment !== b.docComment && (a.docComment || b.docComment)) return false;
  if (JSON.stringify(a.defaultValue) !== JSON.stringify(b.defaultValue)) return false;
  if (!areConstraintsEqual(a.constraints, b.constraints)) {
    return false;
  }
  return true;
}

/**
 * Computes semantic and structural differences between two EntitySpecs.
 */
export function computeEntitySpecDiff(
  currentSpec: EntitySpec,
  targetSpec: EntitySpec
): ASTDiff[] {
  const diffs: ASTDiff[] = [];

  // Entity-level changes
  if (currentSpec.name !== targetSpec.name) {
    diffs.push({
      kind: 'update-entity',
      path: 'name',
      oldValue: currentSpec.name,
      newValue: targetSpec.name,
      description: `Renamed entity from '${currentSpec.name}' to '${targetSpec.name}'`,
    });
  }

  if (currentSpec.kind !== targetSpec.kind) {
    diffs.push({
      kind: 'update-entity',
      path: 'kind',
      oldValue: currentSpec.kind,
      newValue: targetSpec.kind,
      description: `Changed entity kind from '${currentSpec.kind}' to '${targetSpec.kind}'`,
    });
  }

  if (currentSpec.docComment !== targetSpec.docComment && (currentSpec.docComment || targetSpec.docComment)) {
    diffs.push({
      kind: 'update-doc-comment',
      path: 'docComment',
      oldValue: currentSpec.docComment,
      newValue: targetSpec.docComment,
      description: 'Updated entity docComment',
    });
  }

  if (JSON.stringify(currentSpec.discriminator) !== JSON.stringify(targetSpec.discriminator)) {
    diffs.push({
      kind: 'update-discriminator',
      path: 'discriminator',
      oldValue: currentSpec.discriminator,
      newValue: targetSpec.discriminator,
      description: 'Updated entity discriminator',
    });
  }

  // Extends clauses
  const currentExtends = currentSpec.extends || [];
  const targetExtends = targetSpec.extends || [];

  for (const ext of targetExtends) {
    if (!currentExtends.includes(ext)) {
      diffs.push({
        kind: 'add-extends',
        path: 'extends',
        newValue: ext,
        description: `Added extends '${ext}'`,
      });
    }
  }

  for (const ext of currentExtends) {
    if (!targetExtends.includes(ext)) {
      diffs.push({
        kind: 'remove-extends',
        path: 'extends',
        oldValue: ext,
        description: `Removed extends '${ext}'`,
      });
    }
  }

  // Properties comparison
  const currentProps = currentSpec.properties || {};
  const targetProps = targetSpec.properties || {};

  // Check added and updated properties
  for (const [propName, targetProp] of Object.entries(targetProps)) {
    const currentProp = currentProps[propName];
    if (!currentProp) {
      diffs.push({
        kind: 'add-property',
        path: `properties.${propName}`,
        propertyName: propName,
        newValue: targetProp,
        description: `Added property '${propName}'`,
      });
    } else if (!arePropertiesEqual(currentProp, targetProp)) {
      diffs.push({
        kind: 'update-property',
        path: `properties.${propName}`,
        propertyName: propName,
        oldValue: currentProp,
        newValue: targetProp,
        description: `Updated property '${propName}'`,
      });
    }
  }

  // Check removed properties
  for (const [propName, currentProp] of Object.entries(currentProps)) {
    if (!(propName in targetProps)) {
      diffs.push({
        kind: 'remove-property',
        path: `properties.${propName}`,
        propertyName: propName,
        oldValue: currentProp,
        description: `Removed property '${propName}'`,
      });
    }
  }

  return diffs;
}
