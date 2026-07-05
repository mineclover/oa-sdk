import {
  addKafkaEvidence,
  kafkaFieldNodeIdFor,
} from './kafka-profile-evidence.js'
import type {
  KafkaFieldProfileAppendInput,
  KafkaFieldProfileContext,
} from './kafka-profile-field-types.js'

export function createKafkaFieldProfileContext(input: KafkaFieldProfileAppendInput): KafkaFieldProfileContext {
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

  return {
    ...input,
    fieldPath,
    fieldPointer,
    absolutePath,
    evidenceId,
    fieldNodeId: kafkaFieldNodeIdFor(input.topicName, fieldPath),
  }
}
