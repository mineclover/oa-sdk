import type { RegistryRelationship, RegistrySnapshot } from '../registry/types.js'
import {
  createDpmDiagnostic,
  type DpmDiagnostic,
  type DpmRegistryCoordinate,
} from './diagnostics.js'

export function createRegistryMismatchDiagnostic(input: {
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
    registryCoordinate: createRegistryCoordinate(input.registry, input.relationshipName, input.approved),
  })
}

export function createRegistryCoordinate(
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
