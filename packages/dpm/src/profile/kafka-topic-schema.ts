import {
  addKafkaEvidence,
  kafkaCoordinate,
} from './kafka-profile-graph.js'
import type { KafkaTopicSectionAppendInput } from './kafka-topic-section-types.js'

export function appendKafkaSchema(input: KafkaTopicSectionAppendInput): void {
  if (!input.topic.schema) return

  const schemaEvidenceId = addKafkaEvidence(input.evidenceSources, {
    id: `evidence:kafka:${input.topic.name}.schema.${input.topic.schema.subject}`,
    sourceId: input.sourceId,
    connectorId: input.connectorId,
    path: `${input.topic.name}.schema.${input.topic.schema.subject}`,
    pointer: '/schema',
    description: input.topic.schema.format,
  })
  const schemaNodeId = `node:schema-subject:${input.topic.schema.subject}`
  input.nodes.push({
    id: schemaNodeId,
    kind: 'schema_subject',
    label: input.topic.schema.subject,
    coordinate: kafkaCoordinate(input.sourceId, `${input.topic.name}.schema.${input.topic.schema.subject}`, '/schema'),
    dataType: input.topic.schema.format,
    shape: {
      latestVersion: Math.max(...input.topic.schema.versions),
    },
  })
  input.edges.push({
    id: `edge:${input.topic.name}.schema_version_of.${input.topic.schema.subject}`,
    kind: 'schema_version_of',
    fromNodeId: schemaNodeId,
    toNodeId: input.topicNodeId,
    evidenceIds: [schemaEvidenceId],
  })
  input.metrics.push({
    id: `metric:${input.topic.name}.schema_version_count`,
    kind: 'schema_version_count',
    subjectId: schemaNodeId,
    value: input.topic.schema.versions.length,
    unit: 'versions',
    evidenceIds: [schemaEvidenceId],
  })
}
