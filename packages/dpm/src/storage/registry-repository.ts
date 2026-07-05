import type {
  DpmRegistryRepository,
  DpmRegistryStorageReader,
} from './registry-repository-types.js'
import { registryRowsToSnapshot } from './registry-row-mapper.js'

export type {
  DpmRegistryRelationshipRow,
  DpmRegistryRelationshipRowRequest,
  DpmRegistryRepository,
  DpmRegistryRowsToSnapshotInput,
  DpmRegistrySnapshotExportRequest,
  DpmRegistryStorageReader,
} from './registry-repository-types.js'
export { registryRowsToSnapshot } from './registry-row-mapper.js'

export function createDpmRegistryRepository(reader: DpmRegistryStorageReader): DpmRegistryRepository {
  return {
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
}
