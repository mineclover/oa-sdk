import {
  gatewayOperation,
  jsonRequestBody,
  pathParameter,
} from './openapi-operation.js'

export function createDpmRelationshipGatewayPaths() {
  return {
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
  } as const
}
