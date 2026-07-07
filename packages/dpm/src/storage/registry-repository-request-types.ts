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

export type DpmRegistryRelationshipAuditEventRequest = {
  datasetId: string
  registryVersion: string
  relationshipName?: string
}

export type DpmRegistryRelationshipSaveInput = {
  datasetId: string
  registryVersion: string
  relationship: ApprovedRegistryRelationshipInput
  auditEventId?: string
  auditOccurredAt?: string
  auditCreatedAt?: string
  sourceFreshnessHash?: string
  createdAt?: string
  updatedAt?: string
}
