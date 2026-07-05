import type { DpmKafkaMessageFieldFixture } from './kafka-fixture-types.js'
import {
  addKafkaEvidence,
  kafkaContainsEdge,
  kafkaCoordinate,
  kafkaFieldNodeIdFor,
} from './kafka-profile-evidence.js'
import type {
  DpmProfileEdge,
  DpmProfileMetric,
  DpmProfileNode,
} from './profile-graph-types.js'
import type { DpmProfileEvidenceSource } from './profile-source-types.js'

export type KafkaFieldProfileAppendInput = {
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
