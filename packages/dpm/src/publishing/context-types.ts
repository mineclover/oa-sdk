import type { DpmCompiledPlan } from '../compiler/plan.js'
import type { DpmAiSchemaContext } from './ai-schema-types.js'
import type { DpmPhysicalForeignKeyRecommendation } from './physical-fk-types.js'
import type { DpmRelationshipMetadata } from './relationship-types.js'

export type DpmPublishingContextInput = {
  plan: DpmCompiledPlan
  includeExamples?: boolean
  includePhysicalForeignKeyRecommendations?: boolean
}

export type DpmPublishingContext = {
  kind: 'dpm.publishing-context.v1'
  manifestId: string
  datasetId: string
  relationshipMetadata: DpmRelationshipMetadata[]
  aiSchemaContext: DpmAiSchemaContext
  physicalForeignKeyRecommendations: DpmPhysicalForeignKeyRecommendation[]
}
