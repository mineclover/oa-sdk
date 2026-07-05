import type {
  DpmJobRepository,
  DpmJobStorage,
} from './job-repository-types.js'
import { createDpmJobRow } from './job-row-builder.js'

export { DPM_JOB_KIND } from './job-repository-types.js'
export type {
  DpmJobOperation,
  DpmJobRepository,
  DpmJobRequest,
  DpmJobRow,
  DpmJobSaveInput,
  DpmJobStatus,
  DpmJobStorage,
} from './job-repository-types.js'
export { createDpmJobRow } from './job-row-builder.js'

export function createDpmJobRepository(storage: DpmJobStorage): DpmJobRepository {
  return {
    async saveJob(input) {
      const row = createDpmJobRow(input)
      await storage.upsertJob(row)
      return row
    },
    async getJob(request) {
      const row = await storage.getJob(request)
      return row ? createDpmJobRow(row) : undefined
    },
  }
}
