import {
  profileAnalysisReport,
  profileArtifact,
  profileCoordinate,
  relationshipHint,
} from './gateway-profile-fixtures.js'
import type {
  GatewayMinimalResponseCase,
} from './gateway-workflow-response-case-types.js'

export const gatewayProfileMinimalResponseCases = [
  ['DpmProfileInspectionResponse', {
    profileArtifact,
    nodeCount: 1,
    edgeCount: 0,
    metricCount: 0,
    diagnostics: [],
  }],
  ['DpmProfileAnalysisResponse', {
    analysisReport: profileAnalysisReport,
  }],
  ['DpmProfileProposalReviewResponse', {
    proposalId: relationshipHint.id,
    status: 'accepted',
    reviewedBy: 'privacy-reviewer',
    reason: 'reviewed against catalog evidence',
    coordinate: profileCoordinate,
    relationshipHint,
    diagnostics: [],
  }],
] as const satisfies readonly GatewayMinimalResponseCase[]

