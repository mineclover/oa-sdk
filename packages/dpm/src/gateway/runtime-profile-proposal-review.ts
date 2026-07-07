import type {
  DpmGatewayProfileProposalReviewInput,
  DpmGatewayProfileProposalReviewResult,
} from './runtime-profile-types.js'
import type { DpmGatewayRuntimeResponse } from './runtime-response-types.js'
import type { DpmProfileDiagnostic } from '../profile/types.js'
import { createDpmGatewayRuntimeResponse } from './runtime-response.js'

export async function reviewDpmProfileProposalRuntime(
  input: DpmGatewayProfileProposalReviewInput,
): Promise<DpmGatewayRuntimeResponse<DpmGatewayProfileProposalReviewResult>> {
  const diagnostics = collectProfileProposalReviewDiagnostics(input)

  return createDpmGatewayRuntimeResponse({
    operationId: 'reviewDpmProfileProposal',
    statusCode: diagnostics.length > 0 ? 400 : 200,
    command: 'review-profile-proposal',
    result: {
      proposalId: input.proposalId,
      status: input.status,
      reviewedBy: input.reviewedBy,
      reason: input.reason,
      ...(input.reviewedAt ? { reviewedAt: input.reviewedAt } : {}),
      ...(input.coordinate ? { coordinate: input.coordinate } : {}),
      ...(input.relationshipHint ? { relationshipHint: input.relationshipHint } : {}),
      diagnostics,
    },
  })
}

function collectProfileProposalReviewDiagnostics(
  input: DpmGatewayProfileProposalReviewInput,
): DpmProfileDiagnostic[] {
  if (!input.relationshipHint || input.relationshipHint.id === input.proposalId) return []

  return [{
    severity: 'error',
    code: 'PROF201',
    message: `Profile proposal review target ${input.proposalId} does not match relationship hint ${input.relationshipHint.id}.`,
    ...(input.coordinate ? { coordinate: input.coordinate } : {}),
    evidenceIds: input.relationshipHint.evidenceIds,
  }]
}
