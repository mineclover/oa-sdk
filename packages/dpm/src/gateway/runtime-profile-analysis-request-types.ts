import type { DpmProfileArtifact } from '../profile/types.js'
import type {
  DpmProfileBaselineRepository,
  DpmProfileBaselineSelectionStrategy,
  DpmProfileBaselineSummary,
} from '../storage/profile-baseline-repository.js'
import type { DpmGatewayProfileAnalysisInput } from './runtime-profile-types.js'

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

export type DpmGatewayProfileAnalysisResolvedRequest = {
  runtimeInput: DpmGatewayProfileAnalysisInput
  previousProfileBaselineSummary?: DpmProfileBaselineSummary
}

export type DpmGatewayProfileAnalysisBaselineResolver =
  Pick<DpmProfileBaselineRepository, 'getProfileBaseline'>
  & Partial<Pick<DpmProfileBaselineRepository, 'selectPreviousProfileBaseline'>>
