import type { ApprovedRegistryRelationshipInput } from '../registry/registry-relationship-types.js'

export type DpmRegistrySnapshotExportRequest = {
  datasetId: string
  registryVersion: string
  exportedAt?: string
}

export type DpmRegistryRelationshipRowRequest = {
  datasetId: string
  registryVersion: string
}

export type DpmRegistryRelationshipSaveInput = {
  datasetId: string
  registryVersion: string
  relationship: ApprovedRegistryRelationshipInput
  sourceFreshnessHash?: string
  createdAt?: string
  updatedAt?: string
}
