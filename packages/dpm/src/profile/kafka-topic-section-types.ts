import type {
  DpmKafkaTopicFixture,
} from './kafka-fixture-types.js'
import type {
  DpmProfileEdge,
  DpmProfileMetric,
  DpmProfileNode,
} from './profile-graph-types.js'
import type { DpmProfileEvidenceSource } from './profile-source-types.js'

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
