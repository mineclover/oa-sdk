import { createKafkaRelationshipHintEdge } from './kafka-profile-hint-edge.js'
import { addKafkaRelationshipHintEvidence } from './kafka-profile-hint-evidence.js'
import { createKafkaRelationshipHintNode } from './kafka-profile-hint-node.js'
import type { KafkaRelationshipHintAppendInput } from './kafka-profile-hint-types.js'

export type {
  KafkaRelationshipHintAppendInput,
  KafkaRelationshipHintContext,
} from './kafka-profile-hint-types.js'

export function appendKafkaRelationshipHint(input: KafkaRelationshipHintAppendInput): void {
  const evidenceId = addKafkaRelationshipHintEvidence(input)

  input.nodes.push(createKafkaRelationshipHintNode(input))
  input.edges.push(createKafkaRelationshipHintEdge({
    ...input,
    evidenceId,
  }))
}
