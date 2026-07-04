import type { RegistryRelationship, RegistrySnapshot } from '../registry/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
  type DpmRegistryCoordinate,
} from './diagnostics.js'
import type {
  ManifestRelationship,
  ManifestRelationshipEndpoint,
  RelationshipRegistryReference,
} from './relationship-types.js'
import { sameColumns, toStringArray } from './relationship-utils.js'

export function validateRelationshipRegistryReference(input: {
  registryReference?: RelationshipRegistryReference
  registry: RegistrySnapshot
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const registryDatasetId = input.registryReference?.dataset_id ?? input.registryReference?.datasetId
  const registryVersion = input.registryReference?.registry_version ?? input.registryReference?.registryVersion

  if (registryDatasetId && registryDatasetId !== input.registry.datasetId) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL011',
      message: `Manifest registry dataset ${registryDatasetId} does not match snapshot ${input.registry.datasetId}.`,
      sourcePointer: '/relationship_registry/dataset_id',
      registryCoordinate: {
        datasetId: input.registry.datasetId,
        registryVersion: input.registry.registryVersion,
      },
    }))
  }
  if (registryVersion && registryVersion !== input.registry.registryVersion) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL011',
      message: `Manifest registry version ${registryVersion} does not match snapshot ${input.registry.registryVersion}.`,
      sourcePointer: '/relationship_registry/registry_version',
      registryCoordinate: {
        datasetId: input.registry.datasetId,
        registryVersion: input.registry.registryVersion,
      },
    }))
  }

  return diagnostics
}

export function validateRelationshipRegistryApproval(input: {
  registry: RegistrySnapshot
  relationship: ManifestRelationship
  pointer: string
}): DpmDiagnostic[] {
  const name = input.relationship.name ?? ''
  const registryMatches = input.registry.relationships.filter(entry => entry.name === name)
  const approvedMatches = input.registry.approvedRelationships.filter(entry => entry.name === name)

  if (registryMatches.length === 0) {
    return [createDpmDiagnostic({
      severity: 'error',
      code: 'REL010',
      message: `Relationship ${name} is missing from registry snapshot.`,
      sourcePointer: `${input.pointer}/name`,
      registryCoordinate: registryCoordinate(input.registry, name),
    })]
  }
  if (approvedMatches.length === 0) {
    return [createDpmDiagnostic({
      severity: 'error',
      code: 'REL006',
      message: `Relationship ${name} is not approved in registry snapshot.`,
      sourcePointer: `${input.pointer}/name`,
      registryCoordinate: registryCoordinate(input.registry, name, registryMatches[0]),
    })]
  }
  if (approvedMatches.length > 1) {
    return [createDpmDiagnostic({
      severity: 'error',
      code: 'REL012',
      message: `Relationship ${name} has multiple approved registry matches.`,
      sourcePointer: `${input.pointer}/name`,
      registryCoordinate: registryCoordinate(input.registry, name, approvedMatches[0]),
    })]
  }

  return validateApprovedRegistrySnapshot({
    registry: input.registry,
    relationship: input.relationship,
    approved: approvedMatches[0]!,
    pointer: input.pointer,
  })
}

function validateApprovedRegistrySnapshot(input: {
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

function createRegistryMismatchDiagnostic(input: {
  registry: RegistrySnapshot
  approved: RegistryRelationship
  relationshipName: string
  label: string
  sourcePointer: string
}): DpmDiagnostic {
  return createDpmDiagnostic({
    severity: 'error',
    code: 'REL013',
    message: `Relationship ${input.relationshipName} ${input.label} must match the approved registry snapshot.`,
    sourcePointer: input.sourcePointer,
    registryCoordinate: registryCoordinate(input.registry, input.relationshipName, input.approved),
  })
}

function registryCoordinate(
  registry: RegistrySnapshot,
  relationshipName: string,
  relationship?: RegistryRelationship,
): DpmRegistryCoordinate {
  return {
    datasetId: registry.datasetId,
    registryVersion: registry.registryVersion,
    relationshipName,
    ...(relationship?.version ? { relationshipVersion: relationship.version } : {}),
    ...(relationship?.status ? { status: relationship.status } : {}),
  }
}
