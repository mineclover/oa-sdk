import type {
  DpmProfileAnalysisInput,
  DpmProfileAnalysisReport,
  DpmProfileRelationshipHintProposal,
} from '../profile/analysis-types.js'
import type {
  DpmProfileArtifact,
  DpmProfileCoordinate,
  DpmProfileDiagnostic,
} from '../profile/types.js'
import type { DpmProfileProposalReviewStatus } from './profile-proposal.js'

export type DpmGatewayProfileInspectionInput = {
  profileArtifact: DpmProfileArtifact
}

export type DpmGatewayProfileInspectionResult = {
  profileArtifact: DpmProfileArtifact
  nodeCount: number
  edgeCount: number
  metricCount: number
  diagnostics: DpmProfileDiagnostic[]
}

export type DpmGatewayProfileAnalysisInput = DpmProfileAnalysisInput

export type DpmGatewayProfileAnalysisResult = {
  analysisReport: DpmProfileAnalysisReport
}

export type DpmGatewayProfileProposalReviewInput = {
  proposalId: string
  status: DpmProfileProposalReviewStatus
  reviewedBy: string
  reason: string
  reviewedAt?: string
  coordinate?: DpmProfileCoordinate
  relationshipHint?: DpmProfileRelationshipHintProposal
}

export type DpmGatewayProfileProposalReviewResult = {
  proposalId: string
  status: DpmProfileProposalReviewStatus
  reviewedBy: string
  reason: string
  reviewedAt?: string
  coordinate?: DpmProfileCoordinate
  relationshipHint?: DpmProfileRelationshipHintProposal
  diagnostics: DpmProfileDiagnostic[]
}
