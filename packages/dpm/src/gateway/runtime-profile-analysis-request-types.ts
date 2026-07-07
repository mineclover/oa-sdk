import type { DpmProfileArtifact } from '../profile/types.js'
import type { DpmProfileBaselineRepository } from '../storage/profile-baseline-repository.js'

export type DpmGatewayProfileBaselineRef = {
  baselineRef: string
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
