import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import { createDpmDiagnostic } from './diagnostic-copy.js'
import type { DpmDiagnostic } from './diagnostic-types.js'
import type { RelationshipRegistryReference } from './relationship-types.js'

export function validateRelationshipRegistryReference(input: {
  metadataDatasetId?: string
  registryReference?: RelationshipRegistryReference
  registry: RegistrySnapshot
}): DpmDiagnostic[] {
  const diagnostics: DpmDiagnostic[] = []
  const registryDatasetId = input.registryReference?.dataset_id ?? input.registryReference?.datasetId
  const registryVersion = input.registryReference?.registry_version ?? input.registryReference?.registryVersion

  if (input.metadataDatasetId && input.metadataDatasetId !== input.registry.datasetId) {
    diagnostics.push(createDpmDiagnostic({
      severity: 'error',
      code: 'REL011',
      message: `Manifest metadata dataset ${input.metadataDatasetId} does not match registry snapshot ${input.registry.datasetId}.`,
      sourcePointer: '/metadata/dataset_id',
      registryCoordinate: {
        datasetId: input.registry.datasetId,
        registryVersion: input.registry.registryVersion,
      },
    }))
  }

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
