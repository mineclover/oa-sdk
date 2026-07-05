import {
  gatewayOperation,
  jsonRequestBody,
  pathParameter,
} from './openapi-operation.js'

export function createDpmProfileGatewayPaths() {
  return {
    '/dpm/profiles/inspect': {
      post: gatewayOperation({
        operationId: 'inspectDpmProfile',
        tags: ['profiles'],
        summary: 'Inspect a normalized profile artifact for editor visualization.',
        requestBody: jsonRequestBody('DpmProfileInspectionRequest'),
        responseSchema: 'DpmProfileInspectionResponse',
      }),
    },
    '/dpm/profiles/analyze': {
      post: gatewayOperation({
        operationId: 'analyzeDpmProfile',
        tags: ['profiles'],
        summary: 'Analyze profile evidence into reviewable hints, risks, drift, and coverage.',
        requestBody: jsonRequestBody('DpmProfileAnalysisRequest'),
        responseSchema: 'DpmProfileAnalysisResponse',
      }),
    },
    '/dpm/profiles/proposals/{proposalId}/review': {
      post: gatewayOperation({
        operationId: 'reviewDpmProfileProposal',
        tags: ['profiles'],
        summary: 'Record an editor-safe review decision for a profile proposal.',
        parameters: [pathParameter('proposalId')],
        requestBody: jsonRequestBody('DpmProfileProposalReviewRequest'),
        responseSchema: 'DpmProfileProposalReviewResponse',
      }),
    },
  } as const
}
