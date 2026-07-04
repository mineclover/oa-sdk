import type { RegistryRelationship, RegistrySnapshot } from '../registry/types.js'
import type { DpmDiagnostic } from './diagnostics.js'
import { createRegistryMismatchDiagnostic } from './relationship-registry-diagnostics.js'
import type {
  ManifestRelationship,
  ManifestRelationshipEndpoint,
} from './relationship-types.js'
import { sameColumns, toStringArray } from './relationship-utils.js'

export function validateApprovedRegistrySnapshot(input: {
  registry: RegistrySnapshot
  relationship: ManifestRelationship
  approved: RegistryRelationship
  pointer: string
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const relationship = input.relationship
  const approved = input.approved

  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.type,
    expected: approved.type,
    label: 'type',
    sourcePointer: `${input.pointer}/type`,
  })
  addEndpointMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.parent,
    expected: approved.parent,
    label: 'parent',
    sourcePointer: `${input.pointer}/parent`,
  })
  addEndpointMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.child,
    expected: approved.child,
    label: 'child',
    sourcePointer: `${input.pointer}/child`,
  })
  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.namespace,
    expected: approved.namespace,
    label: 'namespace',
    sourcePointer: `${input.pointer}/namespace`,
  })
  addScalarMismatch({
    diagnostics,
    registry: input.registry,
    approved,
    relationshipName: relationship.name ?? '',
    actual: relationship.transform_strategy ?? relationship.transformStrategy,
    expected: approved.transformStrategy,
    label: 'transform_strategy',
    sourcePointer: `${input.pointer}/transform_strategy`,
  })
  addScalarMismatch({
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

function addScalarMismatch(input: {
  diagnostics: DpmDiagnostic[]
  registry: RegistrySnapshot
  approved: RegistryRelationship
  relationshipName: string
  actual: string | undefined
  expected: string
  label: string
  sourcePointer: string
}): void {
  if (input.actual === input.expected) return
  input.diagnostics.push(createRegistryMismatchDiagnostic(input))
}

function addEndpointMismatch(input: {
  diagnostics: DpmDiagnostic[]
  registry: RegistrySnapshot
  approved: RegistryRelationship
  relationshipName: string
  actual: ManifestRelationshipEndpoint | undefined
  expected: RegistryRelationship['parent']
  label: string
  sourcePointer: string
}): void {
  const actualTable = input.actual?.table
  const actualColumns = toStringArray(input.actual?.columns)
  if (actualTable === input.expected.table && sameColumns(actualColumns, input.expected.columns)) return
  input.diagnostics.push(createRegistryMismatchDiagnostic(input))
}
