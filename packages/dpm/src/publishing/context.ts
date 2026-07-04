import type { DpmCompiledPlan, DpmRelationshipStep } from '../compiler/plan.js'

export const DPM_PUBLISHING_CONTEXT_KIND = 'dpm.publishing-context.v1' as const

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
  kind: typeof DPM_PUBLISHING_CONTEXT_KIND
  manifestId: string
  datasetId: string
  relationshipMetadata: DpmRelationshipMetadata[]
  aiSchemaContext: DpmAiSchemaContext
  physicalForeignKeyRecommendations: DpmPhysicalForeignKeyRecommendation[]
}

export function createDpmPublishingContext(input: DpmPublishingContextInput): DpmPublishingContext {
  const relationshipMetadata = input.plan.relationshipSteps.map(toRelationshipMetadata)
  const relationships = relationshipMetadata.map(relationship =>
    toAiRelationshipContext(relationship, input.includeExamples === true),
  )

  return {
    kind: DPM_PUBLISHING_CONTEXT_KIND,
    manifestId: input.plan.manifestId,
    datasetId: input.plan.datasetId,
    relationshipMetadata,
    aiSchemaContext: {
      datasetId: input.plan.datasetId,
      manifestId: input.plan.manifestId,
      readonlyGrantHints: [
        'Use read-only access to the pseudonymized target dataset.',
        'Do not request source database, secret store, or token lookup access.',
      ],
      relationships,
    },
    physicalForeignKeyRecommendations: input.includePhysicalForeignKeyRecommendations
      ? relationshipMetadata.map(toPhysicalForeignKeyRecommendation)
      : [],
  }
}

function toRelationshipMetadata(step: DpmRelationshipStep): DpmRelationshipMetadata {
  return {
    name: step.name,
    namespace: step.namespace,
    cardinality: step.cardinality,
    parentTable: step.parent.table,
    parentColumns: [...step.parent.columns],
    childTable: step.child.table,
    childColumns: [...step.child.columns],
    joinPredicate: renderJoinPredicate(step),
    transformStrategy: step.transformStrategy,
    orphanPolicy: step.orphanPolicy,
    readonly: true,
  }
}

function toAiRelationshipContext(
  relationship: DpmRelationshipMetadata,
  includeExamples: boolean,
): DpmAiRelationshipContext {
  return {
    name: relationship.name,
    namespace: relationship.namespace,
    cardinality: relationship.cardinality,
    description: `Join ${relationship.childTable} to ${relationship.parentTable} through the ${relationship.namespace} namespace.`,
    joinPredicate: relationship.joinPredicate,
    ...(includeExamples ? {
      examples: relationship.childColumns.map((childColumn, index) => ({
        child: `${relationship.childTable}.${childColumn}`,
        parent: `${relationship.parentTable}.${relationship.parentColumns[index] ?? childColumn}`,
      })),
    } : {}),
  }
}

function toPhysicalForeignKeyRecommendation(
  relationship: DpmRelationshipMetadata,
): DpmPhysicalForeignKeyRecommendation {
  return {
    kind: 'physical_fk_recommendation',
    relationship: relationship.name,
    childTable: relationship.childTable,
    childColumns: [...relationship.childColumns],
    parentTable: relationship.parentTable,
    parentColumns: [...relationship.parentColumns],
    applyMode: 'recommendation_only',
    mutation: 'none',
  }
}

function renderJoinPredicate(step: DpmRelationshipStep): string {
  return step.child.columns
    .map((childColumn, index) => {
      const parentColumn = step.parent.columns[index] ?? childColumn
      return `${step.child.table}.${childColumn} = ${step.parent.table}.${parentColumn}`
    })
    .join(' AND ')
}
