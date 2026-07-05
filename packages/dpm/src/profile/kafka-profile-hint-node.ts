import type { KafkaRelationshipHintContext } from './kafka-profile-hint-types.js'
import type { DpmProfileNode } from './profile-graph-types.js'

export function kafkaRelationshipHintNodeId(input: KafkaRelationshipHintContext): string {
  return `node:relationship-hint:${input.hint.id}`
}

export function createKafkaRelationshipHintNode(input: KafkaRelationshipHintContext): DpmProfileNode {
  return {
    id: kafkaRelationshipHintNodeId(input),
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
  }
}
