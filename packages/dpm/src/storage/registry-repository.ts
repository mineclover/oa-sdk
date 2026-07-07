import type {
  DpmRegistryRelationshipSaveInput,
  DpmRegistryRepository,
  DpmRegistryStorage,
  DpmRegistryStorageReader,
  DpmRegistryWritableRepository,
} from './registry-repository-types.js'
import { registryRowsToSnapshot } from './registry-row-mapper.js'
import {
  copyDpmRegistryRelationshipRow,
  createDpmRegistryRelationshipRow,
} from './registry-row-relationship.js'

export type {
  DpmRegistryRelationshipRow,
  DpmRegistryRelationshipSaveInput,
  DpmRegistryRelationshipRowRequest,
  DpmRegistryRepository,
  DpmRegistryRowsToSnapshotInput,
  DpmRegistrySnapshotExportRequest,
  DpmRegistryStorage,
  DpmRegistryStorageReader,
  DpmRegistryWritableRepository,
} from './registry-repository-types.js'
export { registryRowsToSnapshot } from './registry-row-mapper.js'
export {
  copyDpmRegistryRelationshipRow,
  createDpmRegistryRelationshipRow,
} from './registry-row-relationship.js'

export function createDpmRegistryRepository(storage: DpmRegistryStorage): DpmRegistryWritableRepository
export function createDpmRegistryRepository(reader: DpmRegistryStorageReader): DpmRegistryRepository
export function createDpmRegistryRepository(
  reader: DpmRegistryStorageReader,
): DpmRegistryRepository | DpmRegistryWritableRepository {
  const repository: DpmRegistryRepository = {
    async exportSnapshot(request) {
      const rows = await reader.listRelationshipRows({
        datasetId: request.datasetId,
        registryVersion: request.registryVersion,
      })

      return registryRowsToSnapshot({
        ...request,
        rows,
      })
    },
  }

  if (!isDpmRegistryStorage(reader)) {
    return repository
  }

  return {
    ...repository,
    async saveRelationship(input: DpmRegistryRelationshipSaveInput) {
      const row = createDpmRegistryRelationshipRow(input)
      await reader.upsertRelationshipRow(copyDpmRegistryRelationshipRow(row))
      return row
    },
  }
}

function isDpmRegistryStorage(reader: DpmRegistryStorageReader): reader is DpmRegistryStorage {
  return 'upsertRelationshipRow' in reader && typeof reader.upsertRelationshipRow === 'function'
}
