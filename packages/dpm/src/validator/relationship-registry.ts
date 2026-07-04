import type { RegistrySnapshot } from '../registry/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
} from './diagnostics.js'
import {
  createRegistryCoordinate,
} from './relationship-registry-diagnostics.js'
import { validateApprovedRegistrySnapshot } from './relationship-registry-snapshot.js'
import type {
  ManifestRelationship,
  RelationshipRegistryReference,
} from './relationship-types.js'

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
      registryCoordinate: createRegistryCoordinate(input.registry, name),
    })]
  }
  if (approvedMatches.length === 0) {
    return [createDpmDiagnostic({
      severity: 'error',
      code: 'REL006',
      message: `Relationship ${name} is not approved in registry snapshot.`,
      sourcePointer: `${input.pointer}/name`,
      registryCoordinate: createRegistryCoordinate(input.registry, name, registryMatches[0]),
    })]
  }
  if (approvedMatches.length > 1) {
    return [createDpmDiagnostic({
      severity: 'error',
      code: 'REL012',
      message: `Relationship ${name} has multiple approved registry matches.`,
      sourcePointer: `${input.pointer}/name`,
      registryCoordinate: createRegistryCoordinate(input.registry, name, approvedMatches[0]),
    })]
  }

  return validateApprovedRegistrySnapshot({
    registry: input.registry,
    relationship: input.relationship,
    approved: approvedMatches[0]!,
    pointer: input.pointer,
  })
}
