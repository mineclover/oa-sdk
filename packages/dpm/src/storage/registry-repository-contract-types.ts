import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type {
  DpmRegistryRelationshipRowRequest,
  DpmRegistrySnapshotExportRequest,
} from './registry-repository-request-types.js'
import type { DpmRegistryRelationshipRow } from './registry-storage-row-types.js'

export type DpmRegistryStorageReader = {
  listRelationshipRows(
    request: DpmRegistryRelationshipRowRequest,
  ): Promise<readonly DpmRegistryRelationshipRow[]> | readonly DpmRegistryRelationshipRow[]
}

export type DpmRegistryRepository = {
  exportSnapshot(request: DpmRegistrySnapshotExportRequest): Promise<RegistrySnapshot>
}
