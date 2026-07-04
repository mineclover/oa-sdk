import { createHash } from 'node:crypto'

import type { DpmProfileArtifactInput } from './artifact.js'
import type { DpmKafkaTopicProfileFixture } from './kafka-fixture-types.js'
import {
  addKafkaEvidence,
  appendKafkaFieldProfile,
  appendKafkaRelationshipHint,
  kafkaContainsEdge,
  kafkaCoordinate,
} from './kafka-profile-graph.js'
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

  for (const partition of [...input.topic.partitions].sort((left, right) => left - right)) {
    const partitionEvidenceId = addKafkaEvidence(evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.partition.${partition}`,
      sourceId,
      connectorId,
      path: `${input.topic.name}.partition.${partition}`,
      pointer: `/partitions/${partition}`,
    })
    const partitionNodeId = `node:partition:${input.topic.name}.${partition}`
    nodes.push({
      id: partitionNodeId,
      kind: 'partition',
      label: `${input.topic.name}[${partition}]`,
      coordinate: kafkaCoordinate(sourceId, `${input.topic.name}.partition.${partition}`, `/partitions/${partition}`),
      dataType: 'partition',
    })
    edges.push(kafkaContainsEdge(input.topic.name, topicNodeId, partitionNodeId, partitionEvidenceId))
  }

  if (input.topic.messageRateEstimate !== undefined) {
    metrics.push({
      id: `metric:${input.topic.name}.message_rate_estimate`,
      kind: 'message_rate_estimate',
      subjectId: topicNodeId,
      value: input.topic.messageRateEstimate,
      unit: 'messages_per_second',
      evidenceIds: [topicEvidenceId],
    })
  }

  if (input.topic.key) {
    const keyEvidenceId = addKafkaEvidence(evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.key`,
      sourceId,
      connectorId,
      path: `${input.topic.name}.key`,
      pointer: '/key',
    })
    const keyNodeId = `node:key:${input.topic.name}`
    nodes.push({
      id: keyNodeId,
      kind: 'message_key',
      label: `${input.topic.name} key`,
      coordinate: kafkaCoordinate(sourceId, `${input.topic.name}.key`, '/key'),
      dataType: input.topic.key.dataType,
    })
    edges.push(kafkaContainsEdge(input.topic.name, topicNodeId, keyNodeId, keyEvidenceId))
    if (input.topic.key.coverageRatio !== undefined) {
      metrics.push({
        id: `metric:${input.topic.name}.key_coverage`,
        kind: 'key_coverage_ratio',
        subjectId: keyNodeId,
        value: input.topic.key.coverageRatio,
        unit: 'ratio',
        evidenceIds: [keyEvidenceId],
      })
    }
  }

  for (const header of [...(input.topic.headers ?? [])].sort((left, right) => left.name.localeCompare(right.name))) {
    const headerEvidenceId = addKafkaEvidence(evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.header.${header.name}`,
      sourceId,
      connectorId,
      path: `${input.topic.name}.header.${header.name}`,
      pointer: `/headers/${header.name}`,
    })
    const headerNodeId = `node:header:${input.topic.name}.${header.name}`
    nodes.push({
      id: headerNodeId,
      kind: 'message_header',
      label: `header.${header.name}`,
      coordinate: kafkaCoordinate(sourceId, `${input.topic.name}.header.${header.name}`, `/headers/${header.name}`),
      dataType: header.dataType,
    })
    edges.push(kafkaContainsEdge(input.topic.name, topicNodeId, headerNodeId, headerEvidenceId))
    if (header.presenceRatio !== undefined) {
      metrics.push({
        id: `metric:${input.topic.name}.header.${header.name}.presence`,
        kind: 'presence_ratio',
        subjectId: headerNodeId,
        value: header.presenceRatio,
        unit: 'ratio',
        evidenceIds: [headerEvidenceId],
      })
    }
  }

  if (input.topic.schema) {
    const schemaEvidenceId = addKafkaEvidence(evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.schema.${input.topic.schema.subject}`,
      sourceId,
      connectorId,
      path: `${input.topic.name}.schema.${input.topic.schema.subject}`,
      pointer: '/schema',
      description: input.topic.schema.format,
    })
    const schemaNodeId = `node:schema-subject:${input.topic.schema.subject}`
    nodes.push({
      id: schemaNodeId,
      kind: 'schema_subject',
      label: input.topic.schema.subject,
      coordinate: kafkaCoordinate(sourceId, `${input.topic.name}.schema.${input.topic.schema.subject}`, '/schema'),
      dataType: input.topic.schema.format,
      shape: {
        latestVersion: Math.max(...input.topic.schema.versions),
      },
    })
    edges.push({
      id: `edge:${input.topic.name}.schema_version_of.${input.topic.schema.subject}`,
      kind: 'schema_version_of',
      fromNodeId: schemaNodeId,
      toNodeId: topicNodeId,
      evidenceIds: [schemaEvidenceId],
    })
    metrics.push({
      id: `metric:${input.topic.name}.schema_version_count`,
      kind: 'schema_version_count',
      subjectId: schemaNodeId,
      value: input.topic.schema.versions.length,
      unit: 'versions',
      evidenceIds: [schemaEvidenceId],
    })
  }

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
