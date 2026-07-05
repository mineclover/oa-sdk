import type { DpmKafkaRelationshipHintFixture } from './kafka-fixture-types.js'
import {
  addKafkaEvidence,
  kafkaFieldNodeIdFor,
} from './kafka-profile-evidence.js'
import type {
  DpmProfileEdge,
  DpmProfileEvidenceSource,
  DpmProfileNode,
} from './types.js'

export type KafkaRelationshipHintAppendInput = {
  topicName: string
  sourceId: string
  connectorId: string
  hint: DpmKafkaRelationshipHintFixture
  evidenceSources: Record<string, DpmProfileEvidenceSource>
  nodes: DpmProfileNode[]
  edges: DpmProfileEdge[]
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
