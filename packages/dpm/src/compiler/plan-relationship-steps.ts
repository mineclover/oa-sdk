import type { RegistryRelationship } from '../registry/registry-relationship-types.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type {
  DpmRelationshipStep,
  DpmRelationshipStepCardinality,
} from './plan.js'
import {
  asArray,
  asRecord,
  asString,
} from './plan-value-utils.js'

export function createRelationshipSteps(
  manifest: Record<string, unknown>,
  registry: RegistrySnapshot,
): DpmRelationshipStep[] {
  const approvedByName = new Map(registry.approvedRelationships.map(relationship => [relationship.name, relationship]))
  return asArray(manifest.relationships)
    .map(asRecord)
    .map(relationship => {
      const approved = approvedByName.get(asString(relationship.name))
      if (!approved) return undefined
      return toRelationshipStep(approved)
    })
    .filter((step): step is DpmRelationshipStep => Boolean(step))
    .sort((left, right) => left.name.localeCompare(right.name))
}

function toRelationshipStep(approved: RegistryRelationship): DpmRelationshipStep {
  return {
    name: approved.name,
    registryIdentity: approved.identity,
    registryStatus: 'approved',
    relationshipType: approved.type,
    cardinality: toCardinality(approved.type),
    parent: {
      table: approved.parent.table,
      columns: [...approved.parent.columns],
    },
    child: {
      table: approved.child.table,
      columns: [...approved.child.columns],
    },
    namespace: approved.namespace,
    transformStrategy: approved.transformStrategy,
    orphanPolicy: approved.orphanPolicy,
  }
}

function toCardinality(relationshipType: string): DpmRelationshipStepCardinality {
  if (relationshipType === 'one_to_one') return 'one_to_one'
  if (relationshipType === 'one_to_many') return 'one_to_many'
  if (relationshipType === 'many_to_one') return 'many_to_one'
  if (relationshipType === 'many_to_many_edge') return 'many_to_many'
  if (relationshipType === 'self_reference') return 'self_reference'
  return relationshipType as DpmRelationshipStepCardinality
}
