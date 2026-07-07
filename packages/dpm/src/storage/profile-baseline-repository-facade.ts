import type {
  DpmProfileBaselineRepository,
  DpmProfileBaselineStorage,
} from './profile-baseline-repository-contract-types.js'
import {
  copyDpmProfileBaselineRow,
  createDpmProfileBaselineRow,
} from './profile-baseline-row-builder.js'
import { selectDpmPreviousProfileBaseline } from './profile-baseline-selector.js'

export function createDpmProfileBaselineRepository(
  storage: DpmProfileBaselineStorage,
): DpmProfileBaselineRepository {
  return {
    async saveProfileBaseline(input) {
      const row = createDpmProfileBaselineRow(input)
      await storage.upsertProfileBaseline(copyDpmProfileBaselineRow(row))
      return row
    },
    async getProfileBaseline(request) {
      const row = await storage.getProfileBaseline(request)
      return row ? copyDpmProfileBaselineRow(row) : undefined
    },
    async listProfileBaselines(request) {
      const rows = await storage.listProfileBaselines(request)
      return rows.map(copyDpmProfileBaselineRow)
    },
    async selectPreviousProfileBaseline(request) {
      const rows = await storage.listProfileBaselines({
        datasetId: request.profileArtifact.datasetId,
        profileId: request.profileArtifact.profileId,
      })
      return selectDpmPreviousProfileBaseline({
        profileArtifact: request.profileArtifact,
        baselines: rows,
        ...(request.limit !== undefined ? { limit: request.limit } : {}),
        ...(request.includeCurrentProfileVersionHash !== undefined
          ? { includeCurrentProfileVersionHash: request.includeCurrentProfileVersionHash }
          : {}),
      })
    },
  }
}
