import {
  addKafkaEvidence,
} from './kafka-profile-evidence.js'
import type { KafkaRelationshipHintContext } from './kafka-profile-hint-types.js'
import type { DpmProfileEvidenceSource } from './profile-source-types.js'

export type KafkaRelationshipHintEvidenceInput = KafkaRelationshipHintContext & {
  evidenceSources: Record<string, DpmProfileEvidenceSource>
}

export function addKafkaRelationshipHintEvidence(input: KafkaRelationshipHintEvidenceInput): string {
  return addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topicName}.relationship_hint.${input.hint.id}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topicName}.relationshipHints.${input.hint.id}`,
    pointer: `/relationshipHints/${input.hint.id}`,
    description: input.hint.evidenceRef,
  })
}
