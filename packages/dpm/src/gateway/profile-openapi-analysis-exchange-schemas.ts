import {
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisExchangeGatewaySchemas() {
  return {
    DpmProfileAnalysisRequest: requiredObjectSchema({
      profileArtifact: ref('DpmProfileArtifact'),
      previousProfileArtifact: ref('DpmProfileArtifact'),
      reportId: stringSchema(),
      analyzedAt: stringSchema(),
    }, ['profileArtifact']),
    DpmProfileAnalysisResponse: requiredObjectSchema({
      analysisReport: ref('DpmProfileAnalysisReport'),
    }),
  } as const
}
