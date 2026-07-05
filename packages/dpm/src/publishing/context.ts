import { createDpmAiSchemaContext } from './ai-schema-context.js'
import { toPhysicalForeignKeyRecommendations } from './physical-fk.js'
import { toDpmRelationshipMetadata } from './relationship-metadata.js'
import type {
  DpmPublishingContext,
  DpmPublishingContextInput,
} from './context-types.js'

export const DPM_PUBLISHING_CONTEXT_KIND = 'dpm.publishing-context.v1' as const

export type {
  DpmAiRelationshipContext,
  DpmAiSchemaContext,
} from './ai-schema-types.js'
export type {
  DpmPublishingContext,
  DpmPublishingContextInput,
} from './context-types.js'
export type {
  DpmPhysicalForeignKeyRecommendation,
} from './physical-fk-types.js'
export type {
  DpmRelationshipMetadata,
} from './relationship-types.js'

export function createDpmPublishingContext(input: DpmPublishingContextInput): DpmPublishingContext {
  const relationshipMetadata = input.plan.relationshipSteps.map(toDpmRelationshipMetadata)

  return {
    kind: DPM_PUBLISHING_CONTEXT_KIND,
    manifestId: input.plan.manifestId,
    datasetId: input.plan.datasetId,
    relationshipMetadata,
    aiSchemaContext: createDpmAiSchemaContext({
      datasetId: input.plan.datasetId,
      manifestId: input.plan.manifestId,
      relationshipMetadata,
      includeExamples: input.includeExamples === true,
    }),
    physicalForeignKeyRecommendations: input.includePhysicalForeignKeyRecommendations
      ? toPhysicalForeignKeyRecommendations(relationshipMetadata)
      : [],
  }
}
