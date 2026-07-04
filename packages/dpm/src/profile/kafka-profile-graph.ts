import type {
  DpmProfileCoordinate,
  DpmProfileEdge,
  DpmProfileEvidenceSource,
  DpmProfileMetric,
  DpmProfileNode,
} from './types.js'
import type {
  DpmKafkaMessageFieldFixture,
  DpmKafkaRelationshipHintFixture,
} from './kafka-fixture-types.js'

type KafkaEvidenceInput = {
  id: string
  sourceId: string
  connectorId: string
  path: string
  pointer: string
  description?: string | undefined
}

type KafkaFieldProfileAppendInput = {
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

type KafkaRelationshipHintAppendInput = {
  topicName: string
  sourceId: string
  connectorId: string
  hint: DpmKafkaRelationshipHintFixture
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
}

export function appendKafkaFieldProfile(input: KafkaFieldProfileAppendInput): void {
  const fieldPath = `${input.parentPath}.${input.field.name}`
  const fieldPointer = `${input.parentPointer}/${input.field.name}`
  const absolutePath = `${input.topicName}.${fieldPath}`
  const evidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${absolutePath}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: absolutePath,
    pointer: fieldPointer,
  })
  const fieldNodeId = kafkaFieldNodeIdFor(input.topicName, fieldPath)

  input.nodes.push({
    id: fieldNodeId,
    kind: 'message_field',
    label: fieldPath,
    coordinate: kafkaCoordinate(input.sourceId, absolutePath, fieldPointer),
    dataType: input.field.dataType,
  })
  input.edges.push(kafkaContainsEdge(input.topicName, input.parentNodeId, fieldNodeId, evidenceId))

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
    appendKafkaFieldProfile({
      ...input,
      parentNodeId: fieldNodeId,
      parentPath: fieldPath,
      parentPointer: fieldPointer,
      field: child,
    })
  }
}

export function appendKafkaRelationshipHint(input: KafkaRelationshipHintAppendInput): void {
  const evidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topicName}.relationship_hint.${input.hint.id}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topicName}.relationshipHints.${input.hint.id}`,
    pointer: `/relationshipHints/${input.hint.id}`,
    description: input.hint.evidenceRef,
  })
  const hintNodeId = `node:relationship-hint:${input.hint.id}`
  const fromNodeId = kafkaFieldNodeIdFor(input.topicName, input.hint.fromPath)

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

export function addKafkaEvidence(
  evidenceSources: Record<string, DpmProfileEvidenceSource>,
  input: KafkaEvidenceInput,
): string {
  evidenceSources[input.id] = {
    coordinate: kafkaCoordinate(input.sourceId, input.path, input.pointer),
    connectorId: input.connectorId,
    ...(input.description ? { description: input.description } : {}),
  }
  return input.id
}

export function kafkaCoordinate(sourceId: string, path: string, pointer: string): DpmProfileCoordinate {
  return {
    kind: 'kafka_topic_bundle',
    sourceId,
    path,
    pointer,
  }
}

export function kafkaContainsEdge(topicName: string, fromNodeId: string, toNodeId: string, evidenceId: string): DpmProfileEdge {
  return {
    id: `edge:${topicName}.contains.${toNodeId.replace(/^node:/, '')}`,
    kind: 'contains',
    fromNodeId,
    toNodeId,
    evidenceIds: [evidenceId],
  }
}

function kafkaFieldNodeIdFor(topicName: string, fieldPath: string): string {
  return `node:field:${topicName}.${fieldPath}`
}
