import { createHash } from 'node:crypto'

import type { DpmProfileArtifactInput } from './artifact.js'
import type { DpmKafkaTopicProfileFixture } from './kafka-fixture-types.js'
import {
  addKafkaEvidence,
  appendKafkaFieldProfile,
  appendKafkaRelationshipHint,
  kafkaCoordinate,
} from './kafka-profile-graph.js'
import {
  appendKafkaHeaders,
  appendKafkaKey,
  appendKafkaMessageRateMetric,
  appendKafkaPartitions,
  appendKafkaSchema,
} from './kafka-topic-sections.js'
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
  const sourceId = `source:kafka:${input.topic.name}`
  const sourceVersionHash = computeKafkaFixtureVersionHash(input)
  const evidenceSources: Record<string, DpmProfileEvidenceSource> = {}
  const nodes: DpmProfileNode[] = []
  const edges: DpmProfileEdge[] = []
  const metrics: DpmProfileMetric[] = []

  const topicEvidenceId = addKafkaEvidence(evidenceSources, {
    id: `evidence:kafka:${input.topic.name}`,
    sourceId,
    connectorId,
    path: input.topic.name,
    pointer: '/topic',
    description: `Kafka topic ${input.topic.name}`,
  })
  const topicNodeId = `node:topic:${input.topic.name}`
  nodes.push({
    id: topicNodeId,
    kind: 'topic',
    label: input.topic.name,
    coordinate: kafkaCoordinate(sourceId, input.topic.name, '/topic'),
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
    sources: [
      {
        id: sourceId,
        kind: 'kafka_topic_bundle',
        connectorId,
        connectorVersion,
        refs: [joinKafkaRef(input.clusterRef, input.topic.name)],
        captureMode: 'fixture',
        sourceVersionHash,
      },
    ],
    evidenceSources,
    nodes,
    edges,
    metrics,
    diagnostics: [],
  }
}

function joinKafkaRef(clusterRef: string, topicName: string): string {
  return `${clusterRef.replace(/\/$/, '')}/${topicName}`
}

function computeKafkaFixtureVersionHash(input: DpmKafkaTopicProfileFixture): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const next = record[key]
    if (next !== undefined) sorted[key] = sortValue(next)
  }
  return sorted
}
