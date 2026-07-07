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
      const existingRows = await reader.listRelationshipRows({
        datasetId: input.datasetId,
        registryVersion: input.registryVersion,
      })
      assertNoConflictingApprovedRegistryRelationshipRow(row, existingRows)
      await reader.upsertRelationshipRow(copyDpmRegistryRelationshipRow(row))
      return row
    },
  }
}

function isDpmRegistryStorage(reader: DpmRegistryStorageReader): reader is DpmRegistryStorage {
  return 'upsertRelationshipRow' in reader && typeof reader.upsertRelationshipRow === 'function'
}

function assertNoConflictingApprovedRegistryRelationshipRow(
  row: ReturnType<typeof createDpmRegistryRelationshipRow>,
  existingRows: readonly ReturnType<typeof createDpmRegistryRelationshipRow>[],
): void {
  const conflictingApproved = existingRows.find(existing =>
    existing.status === 'approved'
    && existing.relationshipName === row.relationshipName
    && existing.relationshipVersion !== row.relationshipVersion
  )
  if (!conflictingApproved) return

  throw new Error(
    `DPM registry saveRelationship already has an approved relationship named ${row.relationshipName}: `
    + `existing version ${conflictingApproved.relationshipVersion}, attempted version ${row.relationshipVersion}.`,
  )
}
