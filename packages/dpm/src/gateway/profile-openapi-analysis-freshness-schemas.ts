import {
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisFreshnessGatewaySchemas() {
  return {
    DpmProfileAnalysisFreshness: requiredObjectSchema({
      reportHash: stringSchema(),
      profileVersionHash: stringSchema(),
      previousProfileVersionHash: stringSchema(),
    }, ['reportHash', 'profileVersionHash']),
  } as const
}
