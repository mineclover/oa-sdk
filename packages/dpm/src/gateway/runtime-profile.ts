import { createDpmProfileAnalysisReport } from '../profile/analyze.js'
import type {
  DpmGatewayProfileAnalysisInput,
  DpmGatewayProfileAnalysisResult,
  DpmGatewayProfileInspectionInput,
  DpmGatewayProfileInspectionResult,
  DpmGatewayProfileProposalReviewInput,
  DpmGatewayProfileProposalReviewResult,
} from './runtime-profile-types.js'
import type { DpmGatewayRuntimeResponse } from './runtime-response-types.js'
import { createDpmGatewayRuntimeResponse } from './runtime-response.js'

export async function inspectDpmProfileRuntime(
  input: DpmGatewayProfileInspectionInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileInspectionResult>> {
  return createDpmGatewayRuntimeResponse({
    operationId: 'inspectDpmProfile',
    statusCode: 200,
    command: 'inspect-profile',
    result: {
      profileArtifact: input.profileArtifact,
      nodeCount: input.profileArtifact.nodes.length,
      edgeCount: input.profileArtifact.edges.length,
      metricCount: input.profileArtifact.metrics.length,
      diagnostics: [...input.profileArtifact.diagnostics],
    },
  })
}

export async function analyzeDpmProfileRuntime(
  input: DpmGatewayProfileAnalysisInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileAnalysisResult>> {
  return createDpmGatewayRuntimeResponse({
    operationId: 'analyzeDpmProfile',
    statusCode: 200,
    command: 'analyze-profile',
    result: {
      analysisReport: createDpmProfileAnalysisReport(input),
    },
  })
}

export async function reviewDpmProfileProposalRuntime(
  input: DpmGatewayProfileProposalReviewInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileProposalReviewResult>> {
  return createDpmGatewayRuntimeResponse({
    operationId: 'reviewDpmProfileProposal',
    statusCode: 200,
    command: 'review-profile-proposal',
    result: {
      proposalId: input.proposalId,
      status: input.status,
      reviewedBy: input.reviewedBy,
      reason: input.reason,
      ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
      ...(input.coordinate ? { coordinate: input.coordinate } : {}),
      ...(input.relationshipHint ? { relationshipHint: input.relationshipHint } : {}),
      diagnostics: [],
    },
  })
}
