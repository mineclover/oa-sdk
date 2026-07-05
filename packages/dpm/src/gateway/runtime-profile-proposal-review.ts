import type {
  DpmGatewayProfileProposalReviewInput,
  DpmGatewayProfileProposalReviewResult,
} from './runtime-profile-types.js'
import type { DpmGatewayRuntimeResponse } from './runtime-response-types.js'
import { createDpmGatewayRuntimeResponse } from './runtime-response.js'

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
