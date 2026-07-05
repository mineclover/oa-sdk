import type { RegistryRelationship } from '../registry/registry-relationship-types.js'
import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type { DpmDiagnostic } from './diagnostic-types.js'
import type { ManifestRelationship } from './relationship-types.js'
import {
  addRegistryEndpointMismatch,
  addRegistryScalarMismatch,
} from './relationship-registry-snapshot-mismatch.js'

export function validateApprovedRegistrySnapshot(input: {
  registry: RegistrySnapshot
  relationship: ManifestRelationship
  approved: RegistryRelationship
  pointer: string
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const relationship = input.relationship
  const approved = input.approved

  addRegistryScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.type,
    expected: approved.type,
    label: 'type',
    sourcePointer: `${input.pointer}/type`,
  })
  addRegistryEndpointMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.parent,
    expected: approved.parent,
    label: 'parent',
    sourcePointer: `${input.pointer}/parent`,
  })
  addRegistryEndpointMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.child,
    expected: approved.child,
    label: 'child',
    sourcePointer: `${input.pointer}/child`,
  })
  addRegistryScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.namespace,
    expected: approved.namespace,
    label: 'namespace',
    sourcePointer: `${input.pointer}/namespace`,
  })
  addRegistryScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.transform_strategy ?? relationship.transformStrategy,
    expected: approved.transformStrategy,
    label: 'transform_strategy',
    sourcePointer: `${input.pointer}/transform_strategy`,
  })
  addRegistryScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.orphan_policy ?? relationship.orphanPolicy,
    expected: approved.orphanPolicy,
    label: 'orphan_policy',
    sourcePointer: `${input.pointer}/orphan_policy`,
  })

  return diagnostics
}
