import type { DpmProfileArtifactInput } from './artifact.js'
import type { DpmKafkaTopicProfileFixture } from './kafka-fixture-types.js'
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
import {
  createKafkaTopicSourceDescriptor,
} from './kafka-topic-source.js'
import type {
  DpmProfileEdge,
  DpmProfileEvidenceSource,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'

export type KafkaTopicProfileArtifactInputOptions = {
  input: DpmKafkaTopicProfileFixture
  connectorId: string
  connectorVersion: string
}

export function createKafkaTopicProfileArtifactInput(
  options: KafkaTopicProfileArtifactInputOptions,
): DpmProfileArtifactInput {
  const { input, connectorId, connectorVersion } = options
  const source = createKafkaTopicSourceDescriptor({
    fixture: input,
    connectorId,
    connectorVersion,
  })
  const sourceId = source.id
  const evidenceSources: Record<string, DpmProfileEvidenceSource> = {}
  const nodes: DpmProfileNode[] = []
  const edges: DpmProfileEdge[] = []
  const metrics: DpmProfileMetric[] = []

  const { topicEvidenceId, topicNodeId } = appendKafkaTopicRoot({
    topic: input.topic,
    sourceId,
    connectorId,
    evidenceSources,
    nodes,
  })

  const sectionInput = {
    topic: input.topic,
    sourceId,
    connectorId,
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
      sourceId,
      connectorId,
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

  for (const hint of [...(input.topic.relationshipHints ?? [])].sort((left, right) => left.id.localeCompare(right.id))) {
    appendKafkaRelationshipHint({
      topicName: input.topic.name,
      sourceId,
      connectorId,
      hint,
      evidenceSources,
      nodes,
      edges,
    })
  }

  return {
    profileId: input.profileId,
    datasetId: input.datasetId,
    profileVersion: input.profileVersion,
    createdAt: input.createdAt,
    sources: [source],
    evidenceSources,
    nodes,
    edges,
    metrics,
    diagnostics: [],
  }
}
