import type { DpmKafkaTopicFixture } from './kafka-fixture-topic-types.js'
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

export type KafkaTopicProfileGraphContext = KafkaTopicProfileGraphInput & KafkaTopicProfileGraph & {
  topicEvidenceId: string
  topicNodeId: string
}
