import type { DpmProfileArtifact } from '../profile/types.js'
import type {
  DpmProfileBaselineRepository,
  DpmProfileBaselineSelectionStrategy,
} from '../storage/profile-baseline-repository.js'

export type DpmGatewayProfileBaselineRef = {
  baselineRef?: string
  selectionStrategy?: DpmProfileBaselineSelectionStrategy
  limit?: number
}

export type DpmGatewayProfileAnalysisRequest = {
  profileArtifact: DpmProfileArtifact
  previousProfileArtifact?: DpmProfileArtifact
  previousProfileBaseline?: DpmGatewayProfileBaselineRef
  reportId?: string
  analyzedAt?: string
}

export type DpmGatewayProfileAnalysisBaselineResolver =
  Pick<DpmProfileBaselineRepository, 'getProfileBaseline'>
  & Partial<Pick<DpmProfileBaselineRepository, 'selectPreviousProfileBaseline'>>
