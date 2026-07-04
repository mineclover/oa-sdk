import type {
  DpmKafkaTopicFixture,
} from './kafka-fixture-types.js'
import {
  addKafkaEvidence,
  kafkaContainsEdge,
  kafkaCoordinate,
} from './kafka-profile-graph.js'
import type {
  DpmProfileEdge,
  DpmProfileEvidenceSource,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'

type KafkaTopicSectionAppendInput = {
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

export function appendKafkaPartitions(input: KafkaTopicSectionAppendInput): void {
  for (const partition of [...input.topic.partitions].sort((left, right) => left - right)) {
    const partitionEvidenceId = addKafkaEvidence(input.evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.partition.${partition}`,
      sourceId: input.sourceId,
      connectorId: input.connectorId,
      path: `${input.topic.name}.partition.${partition}`,
      pointer: `/partitions/${partition}`,
    })
    const partitionNodeId = `node:partition:${input.topic.name}.${partition}`
    input.nodes.push({
      id: partitionNodeId,
      kind: 'partition',
      label: `${input.topic.name}[${partition}]`,
      coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.partition.${partition}`, `/partitions/${partition}`),
      dataType: 'partition',
    })
    input.edges.push(kafkaContainsEdge(input.topic.name, input.topicNodeId, partitionNodeId, partitionEvidenceId))
  }
}

export function appendKafkaMessageRateMetric(input: KafkaTopicSectionAppendInput): void {
  if (input.topic.messageRateEstimate === undefined) return
  input.metrics.push({
    id: `metric:${input.topic.name}.message_rate_estimate`,
    kind: 'message_rate_estimate',
    subjectId: input.topicNodeId,
    value: input.topic.messageRateEstimate,
    unit: 'messages_per_second',
    evidenceIds: [input.topicEvidenceId],
  })
}

export function appendKafkaKey(input: KafkaTopicSectionAppendInput): void {
  if (!input.topic.key) return

  const keyEvidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topic.name}.key`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topic.name}.key`,
    pointer: '/key',
  })
  const keyNodeId = `node:key:${input.topic.name}`
  input.nodes.push({
    id: keyNodeId,
    kind: 'message_key',
    label: `${input.topic.name} key`,
    coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.key`, '/key'),
    dataType: input.topic.key.dataType,
  })
  input.edges.push(kafkaContainsEdge(input.topic.name, input.topicNodeId, keyNodeId, keyEvidenceId))

  if (input.topic.key.coverageRatio === undefined) return
  input.metrics.push({
    id: `metric:${input.topic.name}.key_coverage`,
    kind: 'key_coverage_ratio',
    subjectId: keyNodeId,
    value: input.topic.key.coverageRatio,
    unit: 'ratio',
    evidenceIds: [keyEvidenceId],
  })
}

export function appendKafkaHeaders(input: KafkaTopicSectionAppendInput): void {
  for (const header of [...(input.topic.headers ?? [])].sort((left, right) => left.name.localeCompare(right.name))) {
    const headerEvidenceId = addKafkaEvidence(input.evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.header.${header.name}`,
      sourceId: input.sourceId,
      connectorId: input.connectorId,
      path: `${input.topic.name}.header.${header.name}`,
      pointer: `/headers/${header.name}`,
    })
    const headerNodeId = `node:header:${input.topic.name}.${header.name}`
    input.nodes.push({
      id: headerNodeId,
      kind: 'message_header',
      label: `header.${header.name}`,
      coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.header.${header.name}`, `/headers/${header.name}`),
      dataType: header.dataType,
    })
    input.edges.push(kafkaContainsEdge(input.topic.name, input.topicNodeId, headerNodeId, headerEvidenceId))

    if (header.presenceRatio === undefined) continue
    input.metrics.push({
      id: `metric:${input.topic.name}.header.${header.name}.presence`,
      kind: 'presence_ratio',
      subjectId: headerNodeId,
      value: header.presenceRatio,
      unit: 'ratio',
      evidenceIds: [headerEvidenceId],
    })
  }
}

export function appendKafkaSchema(input: KafkaTopicSectionAppendInput): void {
  if (!input.topic.schema) return

  const schemaEvidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topic.name}.schema.${input.topic.schema.subject}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topic.name}.schema.${input.topic.schema.subject}`,
    pointer: '/schema',
    description: input.topic.schema.format,
  })
  const schemaNodeId = `node:schema-subject:${input.topic.schema.subject}`
  input.nodes.push({
    id: schemaNodeId,
    kind: 'schema_subject',
    label: input.topic.schema.subject,
    coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.schema.${input.topic.schema.subject}`, '/schema'),
    dataType: input.topic.schema.format,
    shape: {
      latestVersion: Math.max(...input.topic.schema.versions),
    },
  })
  input.edges.push({
    id: `edge:${input.topic.name}.schema_version_of.${input.topic.schema.subject}`,
    kind: 'schema_version_of',
    fromNodeId: schemaNodeId,
    toNodeId: input.topicNodeId,
    evidenceIds: [schemaEvidenceId],
  })
  input.metrics.push({
    id: `metric:${input.topic.name}.schema_version_count`,
    kind: 'schema_version_count',
    subjectId: schemaNodeId,
    value: input.topic.schema.versions.length,
    unit: 'versions',
    evidenceIds: [schemaEvidenceId],
  })
}
