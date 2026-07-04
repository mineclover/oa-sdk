import { createHash } from 'node:crypto'

import {
  DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS,
  normalizeDpmProfileConnectorResult,
  type DpmProfileConnectorResult,
} from './connector.js'
import {
  normalizeDpmProfileArtifact,
  type DpmProfileArtifactInput,
} from './artifact.js'
import {
  type DpmProfileEdge,
  type DpmProfileEvidenceSource,
  type DpmProfileMetric,
  type DpmProfileNode,
} from './types.js'
import type {
  DpmKafkaMessageFieldFixture,
  DpmKafkaRelationshipHintFixture,
  DpmKafkaTopicProfileFixture,
} from './kafka-fixture-types.js'

export function profileKafkaTopicFixture(input: DpmKafkaTopicProfileFixture): DpmProfileConnectorResult {
  const connectorId = input.connectorId ?? 'dpm.kafka.fixture'
  const connectorVersion = input.connectorVersion ?? '0.1.0'
  const sourceId = `source:kafka:${input.topic.name}`
  const sourceVersionHash = computeKafkaFixtureVersionHash(input)
  const evidenceSources: Record<string, DpmProfileEvidenceSource> = {}
  const nodes: DpmProfileNode[] = []
  const edges: DpmProfileEdge[] = []
  const metrics: DpmProfileMetric[] = []

  const topicEvidenceId = addEvidence(evidenceSources, {
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
    const partitionEvidenceId = addEvidence(evidenceSources, {
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
    edges.push(containsEdge(input.topic.name, topicNodeId, partitionNodeId, partitionEvidenceId))
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
    const keyEvidenceId = addEvidence(evidenceSources, {
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
    edges.push(containsEdge(input.topic.name, topicNodeId, keyNodeId, keyEvidenceId))
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
    const headerEvidenceId = addEvidence(evidenceSources, {
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
    edges.push(containsEdge(input.topic.name, topicNodeId, headerNodeId, headerEvidenceId))
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
    const schemaEvidenceId = addEvidence(evidenceSources, {
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
    appendFieldProfile({
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
    appendRelationshipHint({
      topicName: input.topic.name,
      sourceId,
      connectorId,
      hint,
      evidenceSources,
      nodes,
      edges,
    })
  }

  const profileArtifactInput: DpmProfileArtifactInput = {
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
  const profileArtifact = normalizeDpmProfileArtifact(profileArtifactInput)

  return normalizeDpmProfileConnectorResult({
    connectorId,
    connectorVersion,
    sourceKind: 'kafka_topic_bundle',
    captureMode: 'fixture',
    status: 'completed',
    capabilities: {
      connectorId,
      connectorVersion,
      sourceKinds: ['kafka_topic_bundle'],
      captureModes: ['fixture'],
      supportedEvidenceKinds: [...DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS],
      skippedEvidenceKinds: [],
    },
    observedEvidenceKinds: ['source', 'evidence_source', 'node', 'edge', 'metric'],
    diagnostics: [],
    profileArtifact,
  })
}

type EvidenceInput = {
  id: string
  sourceId: string
  connectorId: string
  path: string
  pointer: string
  description?: string | undefined
}

type FieldAppendInput = {
  topicName: string
  sourceId: string
  connectorId: string
  parentNodeId: string
  parentPath: string
  parentPointer: string
  field: DpmKafkaMessageFieldFixture
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
  metrics: DpmProfileMetric[]
}

type RelationshipHintAppendInput = {
  topicName: string
  sourceId: string
  connectorId: string
  hint: DpmKafkaRelationshipHintFixture
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
}

function appendFieldProfile(input: FieldAppendInput): void {
  const fieldPath = `${input.parentPath}.${input.field.name}`
  const fieldPointer = `${input.parentPointer}/${input.field.name}`
  const absolutePath = `${input.topicName}.${fieldPath}`
  const evidenceId = addEvidence(input.evidenceSources, {
    id: `evidence:kafka:${absolutePath}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: absolutePath,
    pointer: fieldPointer,
  })
  const fieldNodeId = fieldNodeIdFor(input.topicName, fieldPath)

  input.nodes.push({
    id: fieldNodeId,
    kind: 'message_field',
    label: fieldPath,
    coordinate: kafkaCoordinate(input.sourceId, absolutePath, fieldPointer),
    dataType: input.field.dataType,
  })
  input.edges.push(containsEdge(input.topicName, input.parentNodeId, fieldNodeId, evidenceId))

  if (input.field.presenceRatio !== undefined) {
    input.metrics.push({
      id: `metric:${absolutePath}.presence`,
      kind: 'presence_ratio',
      subjectId: fieldNodeId,
      value: input.field.presenceRatio,
      unit: 'ratio',
      evidenceIds: [evidenceId],
    })
  }
  if (input.field.nullRatio !== undefined) {
    input.metrics.push({
      id: `metric:${absolutePath}.null`,
      kind: 'null_ratio',
      subjectId: fieldNodeId,
      value: input.field.nullRatio,
      unit: 'ratio',
      evidenceIds: [evidenceId],
    })
  }

  for (const child of input.field.fields ?? []) {
    appendFieldProfile({
      ...input,
      parentNodeId: fieldNodeId,
      parentPath: fieldPath,
      parentPointer: fieldPointer,
      field: child,
    })
  }
}

function appendRelationshipHint(input: RelationshipHintAppendInput): void {
  const evidenceId = addEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topicName}.relationship_hint.${input.hint.id}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topicName}.relationshipHints.${input.hint.id}`,
    pointer: `/relationshipHints/${input.hint.id}`,
    description: input.hint.evidenceRef,
  })
  const hintNodeId = `node:relationship-hint:${input.hint.id}`
  const fromNodeId = fieldNodeIdFor(input.topicName, input.hint.fromPath)

  input.nodes.push({
    id: hintNodeId,
    kind: 'relationship_hint',
    label: input.hint.label,
    coordinate: {
      kind: 'kafka_topic_bundle',
      sourceId: input.sourceId,
      path: `${input.topicName}.relationshipHints.${input.hint.id}`,
      pointer: `/relationshipHints/${input.hint.id}`,
      externalId: input.hint.toRef,
    },
    shape: {
      fromPath: input.hint.fromPath,
      toRef: input.hint.toRef,
      ...(input.hint.evidenceRef ? { evidenceRef: input.hint.evidenceRef } : {}),
    },
  })
  input.edges.push({
    id: `edge:relationship-hint:${input.hint.id}`,
    kind: 'candidate_relationship',
    fromNodeId,
    toNodeId: hintNodeId,
    confidence: input.hint.confidence,
    evidenceIds: [evidenceId],
  })
}

function addEvidence(
  evidenceSources: Record<string, DpmProfileEvidenceSource>,
  input: EvidenceInput,
): string {
  evidenceSources[input.id] = {
    coordinate: kafkaCoordinate(input.sourceId, input.path, input.pointer),
    connectorId: input.connectorId,
    ...(input.description ? { description: input.description } : {}),
  }
  return input.id
}

function kafkaCoordinate(sourceId: string, path: string, pointer: string) {
  return {
    kind: 'kafka_topic_bundle' as const,
    sourceId,
    path,
    pointer,
  }
}

function containsEdge(topicName: string, fromNodeId: string, toNodeId: string, evidenceId: string): DpmProfileEdge {
  return {
    id: `edge:${topicName}.contains.${toNodeId.replace(/^node:/, '')}`,
    kind: 'contains',
    fromNodeId,
    toNodeId,
    evidenceIds: [evidenceId],
  }
}

function fieldNodeIdFor(topicName: string, fieldPath: string): string {
  return `node:field:${topicName}.${fieldPath}`
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
