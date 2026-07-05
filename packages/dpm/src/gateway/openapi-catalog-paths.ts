import {
  gatewayOperation,
  jsonRequestBody,
} from './openapi-operation.js'

export function createDpmCatalogGatewayPaths() {
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
  } as const
}
