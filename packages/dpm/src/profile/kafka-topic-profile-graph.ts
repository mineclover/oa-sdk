import type { DpmKafkaTopicFixture } from './kafka-fixture-types.js'
import {
  appendKafkaFieldProfile,
  appendKafkaRelationshipHint,
} from './kafka-profile-graph.js'
import { appendKafkaTopicRoot } from './kafka-topic-root.js'
import {
  appendKafkaHeaders,
  appendKafkaKey,
  appendKafkaMessageRateMetric,
  appendKafkaPartitions,
  appendKafkaSchema,
} from './kafka-topic-sections.js'
import type {
  DpmProfileEdge,
  DpmProfileMetric,
  DpmProfileNode,
} from './profile-graph-types.js'
import type { DpmProfileEvidenceSource } from './profile-source-types.js'

export type KafkaTopicProfileGraphInput = {
  topic: DpmKafkaTopicFixture
  sourceId: string
  connectorId: string
}

export type KafkaTopicProfileGraph = {
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
  metrics: DpmProfileMetric[]
}

export function createKafkaTopicProfileGraph(input: KafkaTopicProfileGraphInput): KafkaTopicProfileGraph {
  const evidenceSources: Record<string, DpmProfileEvidenceSource> = {}
  const nodes: DpmProfileNode[] = []
  const edges: DpmProfileEdge[] = []
  const metrics: DpmProfileMetric[] = []

  const { topicEvidenceId, topicNodeId } = appendKafkaTopicRoot({
    topic: input.topic,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    evidenceSources,
    nodes,
  })

  const sectionInput = {
    topic: input.topic,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    topicNodeId,
    topicEvidenceId,
    evidenceSources,
    nodes,
    edges,
    metrics,
  }
  appendKafkaPartitions(sectionInput)
  appendKafkaMessageRateMetric(sectionInput)
  appendKafkaKey(sectionInput)
  appendKafkaHeaders(sectionInput)
  appendKafkaSchema(sectionInput)

  for (const field of input.topic.value.fields) {
    appendKafkaFieldProfile({
      topicName: input.topic.name,
      sourceId: input.sourceId,
      connectorId: input.connectorId,
      parentNodeId: topicNodeId,
      parentPath: 'value',
      parentPointer: '/value',
      field,
      evidenceSources,
      nodes,
      edges,
      metrics,
    })
  }

  const relationshipHints = [...(input.topic.relationshipHints ?? [])]
    .sort((left, right) => left.id.localeCompare(right.id))

  for (const hint of relationshipHints) {
    appendKafkaRelationshipHint({
      topicName: input.topic.name,
      sourceId: input.sourceId,
      connectorId: input.connectorId,
      hint,
      evidenceSources,
      nodes,
      edges,
    })
  }

  return {
    evidenceSources,
    nodes,
    edges,
    metrics,
  }
}
