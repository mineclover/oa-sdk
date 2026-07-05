import {
  addKafkaEvidence,
  kafkaContainsEdge,
  kafkaCoordinate,
} from './kafka-profile-graph.js'
import type { KafkaTopicSectionAppendInput } from './kafka-topic-section-types.js'

export function appendKafkaKey(input: KafkaTopicSectionAppendInput): void {
  if (!input.topic.key) return

  const keyEvidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topic.name}.key`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topic.name}.key`,
    pointer: '/key',
  })
  const keyNodeId = `node:key:${input.topic.name}`
  input.nodes.push({
    id: keyNodeId,
    kind: 'message_key',
    label: `${input.topic.name} key`,
    coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.key`, '/key'),
    dataType: input.topic.key.dataType,
  })
  input.edges.push(kafkaContainsEdge(input.topic.name, input.topicNodeId, keyNodeId, keyEvidenceId))

  if (input.topic.key.coverageRatio === undefined) return
  input.metrics.push({
    id: `metric:${input.topic.name}.key_coverage`,
    kind: 'key_coverage_ratio',
    subjectId: keyNodeId,
    value: input.topic.key.coverageRatio,
    unit: 'ratio',
    evidenceIds: [keyEvidenceId],
  })
}

export function appendKafkaHeaders(input: KafkaTopicSectionAppendInput): void {
  for (const header of [...(input.topic.headers ?? [])].sort((left, right) => left.name.localeCompare(right.name))) {
    const headerEvidenceId = addKafkaEvidence(input.evidenceSources, {
      id: `evidence:kafka:${input.topic.name}.header.${header.name}`,
      sourceId: input.sourceId,
      connectorId: input.connectorId,
      path: `${input.topic.name}.header.${header.name}`,
      pointer: `/headers/${header.name}`,
    })
    const headerNodeId = `node:header:${input.topic.name}.${header.name}`
    input.nodes.push({
      id: headerNodeId,
      kind: 'message_header',
      label: `header.${header.name}`,
      coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.header.${header.name}`, `/headers/${header.name}`),
      dataType: header.dataType,
    })
    input.edges.push(kafkaContainsEdge(input.topic.name, input.topicNodeId, headerNodeId, headerEvidenceId))

    if (header.presenceRatio === undefined) continue
    input.metrics.push({
      id: `metric:${input.topic.name}.header.${header.name}.presence`,
      kind: 'presence_ratio',
      subjectId: headerNodeId,
      value: header.presenceRatio,
      unit: 'ratio',
      evidenceIds: [headerEvidenceId],
    })
  }
}
