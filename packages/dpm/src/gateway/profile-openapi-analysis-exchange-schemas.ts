import {
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisExchangeGatewaySchemas() {
  return {
    DpmProfileBaselineRef: requiredObjectSchema({
      baselineRef: stringSchema(),
    }),
    DpmProfileAnalysisRequest: requiredObjectSchema({
      profileArtifact: ref('DpmProfileArtifact'),
      previousProfileArtifact: ref('DpmProfileArtifact'),
      previousProfileBaseline: ref('DpmProfileBaselineRef'),
      reportId: stringSchema(),
      analyzedAt: stringSchema(),
    }, ['profileArtifact']),
    DpmProfileAnalysisResponse: requiredObjectSchema({
      analysisReport: ref('DpmProfileAnalysisReport'),
    }),
  } as const
}
