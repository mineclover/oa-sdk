import type { DpmKafkaTopicFixture } from './kafka-fixture-types.js'
import {
  addKafkaEvidence,
  kafkaCoordinate,
} from './kafka-profile-graph.js'
import type {
  DpmProfileEvidenceSource,
  DpmProfileNode,
} from './types.js'

export type KafkaTopicRootAppendInput = {
  topic: DpmKafkaTopicFixture
  sourceId: string
  connectorId: string
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
}

export type KafkaTopicRootAppendResult = {
  topicEvidenceId: string
  topicNodeId: string
}

export function appendKafkaTopicRoot(input: KafkaTopicRootAppendInput): KafkaTopicRootAppendResult {
  const topicEvidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topic.name}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: input.topic.name,
    pointer: '/topic',
    description: `Kafka topic ${input.topic.name}`,
  })
  const topicNodeId = `node:topic:${input.topic.name}`
  input.nodes.push({
    id: topicNodeId,
    kind: 'topic',
    label: input.topic.name,
    coordinate: kafkaCoordinate(input.sourceId, input.topic.name, '/topic'),
  })

  return {
    topicEvidenceId,
    topicNodeId,
  }
}
