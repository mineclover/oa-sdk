import type { DpmProfileAnalysisReport } from '../profile/analysis-report-types.js'
import type { DpmProfileArtifact } from '../profile/profile-artifact-types.js'

export type DpmProfileBaselineRequest = {
  baselineRef: string
}

export type DpmProfileBaselineListRequest = {
  datasetId: string
  profileId: string
  limit?: number
}

export type DpmProfileBaselineSaveInput = {
  baselineRef?: string
  profileArtifact: DpmProfileArtifact
  analysisReport?: DpmProfileAnalysisReport
  storedAt?: string
}
