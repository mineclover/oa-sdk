import {
  ref,
  stringSchema,
} from './openapi-schema.js'

export const DPM_GATEWAY_OPERATION_IDS = [
  'profileDpmCatalog',
  'inspectDpmProfile',
  'analyzeDpmProfile',
  'reviewDpmProfileProposal',
  'discoverDpmRelationships',
  'importDpmRelationshipCandidates',
  'approveDpmRelationshipCandidate',
  'exportDpmRegistrySnapshot',
  'validateDpmManifest',
  'compileDpmManifest',
  'dryRunDpmManifest',
  'executeDpmJob',
  'getDpmValidationReport',
] as const

export type DpmGatewayOperationId = typeof DPM_GATEWAY_OPERATION_IDS[number]

export function createDpmGatewayPaths() {
  return {
    '/dpm/catalog/profile': {
      post: operation({
        operationId: 'profileDpmCatalog',
        tags: ['catalog'],
        summary: 'Profile catalog evidence for a DPM dataset.',
        requestBody: requestBody('DpmCatalogProfileRequest'),
        responseSchema: 'DpmCatalogProfileResponse',
      }),
    },
    '/dpm/profiles/inspect': {
      post: operation({
        operationId: 'inspectDpmProfile',
        tags: ['profiles'],
        summary: 'Inspect a normalized profile artifact for editor visualization.',
        requestBody: requestBody('DpmProfileInspectionRequest'),
        responseSchema: 'DpmProfileInspectionResponse',
      }),
    },
    '/dpm/profiles/analyze': {
      post: operation({
        operationId: 'analyzeDpmProfile',
        tags: ['profiles'],
        summary: 'Analyze profile evidence into reviewable hints, risks, drift, and coverage.',
        requestBody: requestBody('DpmProfileAnalysisRequest'),
        responseSchema: 'DpmProfileAnalysisResponse',
      }),
    },
    '/dpm/profiles/proposals/{proposalId}/review': {
      post: operation({
        operationId: 'reviewDpmProfileProposal',
        tags: ['profiles'],
        summary: 'Record an editor-safe review decision for a profile proposal.',
        parameters: [pathParameter('proposalId')],
        requestBody: requestBody('DpmProfileProposalReviewRequest'),
        responseSchema: 'DpmProfileProposalReviewResponse',
      }),
    },
    '/dpm/relationships/discover': {
      post: operation({
        operationId: 'discoverDpmRelationships',
        tags: ['relationships'],
        summary: 'Discover candidate logical relationships from catalog evidence.',
        requestBody: requestBody('DpmRelationshipDiscoveryRequest'),
        responseSchema: 'DpmRelationshipDiscoveryReport',
      }),
    },
    '/dpm/relationships/candidates/import': {
      post: operation({
        operationId: 'importDpmRelationshipCandidates',
        tags: ['relationships'],
        summary: 'Import reviewable relationship candidates.',
        requestBody: requestBody('DpmCandidateImportRequest'),
        responseSchema: 'DpmCandidateImportResponse',
      }),
    },
    '/dpm/relationships/{relationshipName}/approve': {
      post: operation({
        operationId: 'approveDpmRelationshipCandidate',
        tags: ['relationships'],
        summary: 'Approve a candidate logical relationship.',
        parameters: [pathParameter('relationshipName')],
        requestBody: requestBody('DpmRelationshipApprovalRequest'),
        responseSchema: 'DpmRelationshipApprovalResponse',
      }),
    },
    '/dpm/registry/snapshots/{datasetId}/{registryVersion}': {
      get: operation({
        operationId: 'exportDpmRegistrySnapshot',
        tags: ['relationships'],
        summary: 'Export an approved relationship registry snapshot.',
        parameters: [pathParameter('datasetId'), pathParameter('registryVersion')],
        responseSchema: 'DpmRegistrySnapshotResponse',
      }),
    },
    '/dpm/manifests/validate': {
      post: operation({
        operationId: 'validateDpmManifest',
        tags: ['manifests'],
        summary: 'Validate a DPM manifest against catalog and registry snapshots.',
        requestBody: requestBody('DpmManifestValidationRequest'),
        responseSchema: 'DpmValidationResult',
      }),
    },
    '/dpm/manifests/compile': {
      post: operation({
        operationId: 'compileDpmManifest',
        tags: ['manifests'],
        summary: 'Compile a validated DPM manifest into an execution plan.',
        requestBody: requestBody('DpmManifestCompileRequest'),
        responseSchema: 'DpmCompileResult',
      }),
    },
    '/dpm/manifests/dry-run': {
      post: operation({
        operationId: 'dryRunDpmManifest',
        tags: ['manifests'],
        summary: 'Create a dry-run impact report from a compiled DPM plan.',
        requestBody: requestBody('DpmManifestDryRunRequest'),
        responseSchema: 'DpmDryRunResult',
      }),
    },
    '/dpm/jobs/execute': {
      post: operation({
        operationId: 'executeDpmJob',
        tags: ['jobs'],
        summary: 'Start a DPM execution job from a compiled plan reference.',
        requestBody: requestBody('DpmExecuteJobRequest'),
        responseSchema: 'DpmExecuteJobResponse',
        statusCode: '202',
      }),
    },
    '/dpm/jobs/{jobId}/report': {
      get: operation({
        operationId: 'getDpmValidationReport',
        tags: ['jobs'],
        summary: 'Fetch a DPM execution validation report.',
        parameters: [pathParameter('jobId')],
        responseSchema: 'DpmJobReport',
      }),
    },
  } as const
}

function operation(input: {
  operationId: DpmGatewayOperationId
  tags: string[]
  summary: string
  requestBody?: unknown
  responseSchema: string
  parameters?: unknown[]
  statusCode?: '200' | '202'
}) {
  return {
    operationId: input.operationId,
    tags: input.tags,
    summary: input.summary,
    ...(input.parameters ? { parameters: input.parameters } : {}),
    ...(input.requestBody ? { requestBody: input.requestBody } : {}),
    responses: {
      [input.statusCode ?? '200']: {
        description: 'JSON response.',
        content: {
          'application/json': {
            schema: ref(input.responseSchema),
          },
        },
      },
    },
  }
}

function requestBody(schemaName: string) {
  return {
    required: true,
    content: {
      'application/json': {
        schema: ref(schemaName),
      },
    },
  }
}

function pathParameter(name: string) {
  return {
    name,
    in: 'path',
    required: true,
    schema: stringSchema(),
  }
}
