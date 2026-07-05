import type {
  DpmKafkaTopicFixture,
} from './kafka-fixture-types.js'
import type {
  DpmProfileEdge,
  DpmProfileEvidenceSource,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'

export type KafkaTopicSectionAppendInput = {
  topic: DpmKafkaTopicFixture
  sourceId: string
  connectorId: string
  topicNodeId: string
  topicEvidenceId: string
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
  metrics: DpmProfileMetric[]
}
