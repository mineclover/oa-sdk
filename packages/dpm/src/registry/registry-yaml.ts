import { parse } from 'yaml'

import type { RegistrySnapshotInput } from './registry-snapshot-types.js'
import { toRegistryRelationshipInput } from './registry-yaml-relationship.js'
import { optionalString, requireArray, requireRecord, requireString } from './registry-yaml-values.js'

export function registrySnapshotInputFromYaml(yamlText: string): RegistrySnapshotInput {
  const raw = parse(yamlText) as unknown
  return toRegistrySnapshotInput(raw)
}

function toRegistrySnapshotInput(raw: unknown): RegistrySnapshotInput {
  const record = requireRecord(raw, 'registry snapshot')
  const datasetId = requireString(record.datasetId ?? record.dataset_id, 'datasetId')
  const registryVersion = requireString(record.registryVersion ?? record.registry_version, 'registryVersion')
  const relationships = requireArray(record.relationships, 'relationships').map(toRegistryRelationshipInput)
  const exportedAt = optionalString(record.exportedAt ?? record.exported_at, 'exportedAt')

  return {
    datasetId,
    registryVersion,
    ...(exportedAt ? { exportedAt } : {}),
    relationships,
  }
}
