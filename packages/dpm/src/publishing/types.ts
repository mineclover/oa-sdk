import type { DpmCompiledPlan } from '../compiler/plan.js'

export type DpmRelationshipMetadata = {
  name: string
  namespace: string
  cardinality: string
  parentTable: string
  parentColumns: string[]
  childTable: string
  childColumns: string[]
  joinPredicate: string
  transformStrategy: string
  orphanPolicy: string
  readonly: true
}

export type DpmAiRelationshipContext = {
  name: string
  namespace: string
  cardinality: string
  description: string
  joinPredicate: string
  examples?: Array<{
    child: string
    parent: string
  }>
}

export type DpmAiSchemaContext = {
  datasetId: string
  manifestId: string
  readonlyGrantHints: string[]
  relationships: DpmAiRelationshipContext[]
}

export type DpmPhysicalForeignKeyRecommendation = {
  kind: 'physical_fk_recommendation'
  relationship: string
  childTable: string
  childColumns: string[]
  parentTable: string
  parentColumns: string[]
  applyMode: 'recommendation_only'
  mutation: 'none'
}

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
