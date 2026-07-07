import type { RegistrySnapshot } from '../registry/registry-snapshot-types.js'
import type {
  DpmRegistryRelationshipRowRequest,
  DpmRegistryRelationshipSaveInput,
  DpmRegistrySnapshotExportRequest,
} from './registry-repository-request-types.js'
import type { DpmRegistryRelationshipRow } from './registry-storage-row-types.js'

export type DpmRegistryStorageReader = {
  listRelationshipRows(
    request: DpmRegistryRelationshipRowRequest,
  ): Promise<readonly DpmRegistryRelationshipRow[]> | readonly DpmRegistryRelationshipRow[]
}

export type DpmRegistryStorage = DpmRegistryStorageReader & {
  upsertRelationshipRow(row: DpmRegistryRelationshipRow): Promise<void> | void
}

export type DpmRegistryRepository = {
  exportSnapshot(request: DpmRegistrySnapshotExportRequest): Promise<RegistrySnapshot>
}

export type DpmRegistryWritableRepository = DpmRegistryRepository & {
  saveRelationship(input: DpmRegistryRelationshipSaveInput): Promise<DpmRegistryRelationshipRow>
}
