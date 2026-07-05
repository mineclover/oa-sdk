import type { DpmRegistrySnapshotExportRequest } from './registry-repository-request-types.js'
import type { DpmRegistryRelationshipRow } from './registry-storage-row-types.js'

export type DpmRegistryRowsToSnapshotInput = DpmRegistrySnapshotExportRequest & {
  rows: readonly DpmRegistryRelationshipRow[]
}
