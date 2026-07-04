import {
  gatewayOperation,
  jsonRequestBody,
  pathParameter,
} from './openapi-operation.js'

export function createDpmGatewayPaths() {
  return {
    '/dpm/catalog/profile': {
      post: gatewayOperation({
        operationId: 'profileDpmCatalog',
        tags: ['catalog'],
        summary: 'Profile catalog evidence for a DPM dataset.',
        requestBody: jsonRequestBody('DpmCatalogProfileRequest'),
        responseSchema: 'DpmCatalogProfileResponse',
      }),
    },
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
    '/dpm/relationships/discover': {
      post: gatewayOperation({
        operationId: 'discoverDpmRelationships',
        tags: ['relationships'],
        summary: 'Discover candidate logical relationships from catalog evidence.',
        requestBody: jsonRequestBody('DpmRelationshipDiscoveryRequest'),
        responseSchema: 'DpmRelationshipDiscoveryReport',
      }),
    },
    '/dpm/relationships/candidates/import': {
      post: gatewayOperation({
        operationId: 'importDpmRelationshipCandidates',
        tags: ['relationships'],
        summary: 'Import reviewable relationship candidates.',
        requestBody: jsonRequestBody('DpmCandidateImportRequest'),
        responseSchema: 'DpmCandidateImportResponse',
      }),
    },
    '/dpm/relationships/{relationshipName}/approve': {
      post: gatewayOperation({
        operationId: 'approveDpmRelationshipCandidate',
        tags: ['relationships'],
        summary: 'Approve a candidate logical relationship.',
        parameters: [pathParameter('relationshipName')],
        requestBody: jsonRequestBody('DpmRelationshipApprovalRequest'),
        responseSchema: 'DpmRelationshipApprovalResponse',
      }),
    },
    '/dpm/registry/snapshots/{datasetId}/{registryVersion}': {
      get: gatewayOperation({
        operationId: 'exportDpmRegistrySnapshot',
        tags: ['relationships'],
        summary: 'Export an approved relationship registry snapshot.',
        parameters: [pathParameter('datasetId'), pathParameter('registryVersion')],
        responseSchema: 'DpmRegistrySnapshotResponse',
      }),
    },
    '/dpm/manifests/validate': {
      post: gatewayOperation({
        operationId: 'validateDpmManifest',
        tags: ['manifests'],
        summary: 'Validate a DPM manifest against catalog and registry snapshots.',
        requestBody: jsonRequestBody('DpmManifestValidationRequest'),
        responseSchema: 'DpmValidationResult',
      }),
    },
    '/dpm/manifests/compile': {
      post: gatewayOperation({
        operationId: 'compileDpmManifest',
        tags: ['manifests'],
        summary: 'Compile a validated DPM manifest into an execution plan.',
        requestBody: jsonRequestBody('DpmManifestCompileRequest'),
        responseSchema: 'DpmCompileResult',
      }),
    },
    '/dpm/manifests/dry-run': {
      post: gatewayOperation({
        operationId: 'dryRunDpmManifest',
        tags: ['manifests'],
        summary: 'Create a dry-run impact report from a compiled DPM plan.',
        requestBody: jsonRequestBody('DpmManifestDryRunRequest'),
        responseSchema: 'DpmDryRunResult',
      }),
    },
    '/dpm/jobs/execute': {
      post: gatewayOperation({
        operationId: 'executeDpmJob',
        tags: ['jobs'],
        summary: 'Start a DPM execution job from a compiled plan reference.',
        requestBody: jsonRequestBody('DpmExecuteJobRequest'),
        responseSchema: 'DpmExecuteJobResponse',
        statusCode: '202',
      }),
    },
    '/dpm/jobs/{jobId}/report': {
      get: gatewayOperation({
        operationId: 'getDpmValidationReport',
        tags: ['jobs'],
        summary: 'Fetch a DPM execution validation report.',
        parameters: [pathParameter('jobId')],
        responseSchema: 'DpmJobReport',
      }),
    },
  } as const
}
