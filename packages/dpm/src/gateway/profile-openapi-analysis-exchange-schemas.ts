import {
  DPM_PROFILE_BASELINE_SELECTION_STRATEGIES,
} from '../storage/profile-baseline-selection-taxonomy.js'
import {
  integerSchema,
  ref,
  requiredObjectSchema,
  stringSchema,
} from './openapi-schema.js'

export function createDpmProfileAnalysisExchangeGatewaySchemas() {
  return {
    DpmProfileBaselineRef: {
      oneOf: [
        requiredObjectSchema({
          baselineRef: stringSchema(),
        }),
        requiredObjectSchema({
          selectionStrategy: {
            type: 'string',
            enum: [...DPM_PROFILE_BASELINE_SELECTION_STRATEGIES],
          },
          limit: {
            ...integerSchema(),
            minimum: 1,
          },
        }, ['selectionStrategy']),
      ],
    },
    DpmProfileAnalysisRequest: {
      ...requiredObjectSchema({
        profileArtifact: ref('DpmProfileArtifact'),
        previousProfileArtifact: ref('DpmProfileArtifact'),
        previousProfileBaseline: ref('DpmProfileBaselineRef'),
        reportId: stringSchema(),
        analyzedAt: stringSchema(),
      }, ['profileArtifact']),
      not: {
        required: ['previousProfileArtifact', 'previousProfileBaseline'],
      },
    },
    DpmProfileAnalysisResponse: requiredObjectSchema({
      analysisReport: ref('DpmProfileAnalysisReport'),
    }),
  } as const
}
