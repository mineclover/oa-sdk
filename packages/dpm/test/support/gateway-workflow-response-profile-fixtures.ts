import {
  profileAnalysisReport,
  profileArtifact,
  profileCoordinate,
  relationshipHint,
} from './gateway-profile-fixtures.js'
import {
  DPM_PROFILE_BASELINE_KIND,
} from '../../src/index.js'
import type {
  GatewayMinimalResponseCase,
} from './gateway-workflow-response-case-types.js'

export const profileBaselineSummary = {
  kind: DPM_PROFILE_BASELINE_KIND,
  baselineRef: 'dpm-profile-baseline:commerce_ai:profile:kafka:orders-created:sha256:profile',
  datasetId: 'commerce_ai',
  profileId: 'profile:kafka:orders-created',
  profileVersion: '2026-07-07',
  profileVersionHash: 'sha256:profile',
  profileSummary: {
    nodeCount: 1,
    edgeCount: 0,
    metricCount: 0,
    diagnosticCount: 0,
  },
  hasAnalysisReport: false,
}

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
  ['DpmProfileBaselineSummaryListResponse', {
    baselineSummaries: [profileBaselineSummary],
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
