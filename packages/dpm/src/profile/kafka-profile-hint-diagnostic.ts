import {
  kafkaCoordinate,
  kafkaFieldNodeIdFor,
} from './kafka-profile-evidence.js'
import type { KafkaRelationshipHintContext } from './kafka-profile-hint-types.js'
import type { DpmProfileDiagnostic } from './profile-artifact-types.js'

export type UnresolvedKafkaRelationshipHintSourceDiagnosticInput = KafkaRelationshipHintContext & {
  evidenceId: string
}

export function kafkaRelationshipHintSourceNodeId(input: KafkaRelationshipHintContext): string {
  return kafkaFieldNodeIdFor(input.topicName, input.hint.fromPath)
}

export function createUnresolvedKafkaRelationshipHintSourceDiagnostic(
  input: UnresolvedKafkaRelationshipHintSourceDiagnosticInput,
): DpmProfileDiagnostic {
  return {
    severity: 'warning',
    code: 'PROF301',
    message: `Kafka relationship hint ${input.hint.id} references unresolved source field ${input.hint.fromPath}.`,
    connectorId: input.connectorId,
    coordinate: kafkaCoordinate(
      input.sourceId,
      `${input.topicName}.relationshipHints.${input.hint.id}`,
      `/relationshipHints/${input.hint.id}`,
    ),
    evidenceIds: [input.evidenceId],
  }
}
