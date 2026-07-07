import type { KafkaRelationshipHintContext } from './kafka-profile-hint-types.js'
import {
  kafkaRelationshipHintNodeId,
  kafkaRelationshipHintPath,
  kafkaRelationshipHintPointer,
} from './kafka-profile-hint-identity.js'
import type { DpmProfileNode } from './profile-graph-types.js'

export function createKafkaRelationshipHintNode(input: KafkaRelationshipHintContext): DpmProfileNode {
  return {
    id: kafkaRelationshipHintNodeId(input),
    kind: 'relationship_hint',
    label: input.hint.label,
    coordinate: {
      kind: 'kafka_topic_bundle',
      sourceId: input.sourceId,
      path: kafkaRelationshipHintPath(input),
      pointer: kafkaRelationshipHintPointer(input),
      externalId: input.hint.toRef,
    },
    shape: {
      fromPath: input.hint.fromPath,
      toRef: input.hint.toRef,
      ...(input.hint.evidenceRef ? { evidenceRef: input.hint.evidenceRef } : {}),
    },
  }
}
