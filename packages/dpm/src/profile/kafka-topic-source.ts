import { createHash } from 'node:crypto'

import type { DpmKafkaTopicProfileFixture } from './kafka-fixture-types.js'
import type { DpmProfileSourceDescriptor } from './types.js'

export function kafkaTopicSourceId(topicName: string): string {
  return `source:kafka:${topicName}`
}

export function createKafkaTopicSourceDescriptor(input: {
  fixture: DpmKafkaTopicProfileFixture
  connectorId: string
  connectorVersion: string
}): DpmProfileSourceDescriptor {
  const { fixture, connectorId, connectorVersion } = input
  return {
    id: kafkaTopicSourceId(fixture.topic.name),
    kind: 'kafka_topic_bundle',
    connectorId,
    connectorVersion,
    refs: [joinKafkaRef(fixture.clusterRef, fixture.topic.name)],
    captureMode: 'fixture',
    sourceVersionHash: computeKafkaFixtureVersionHash(fixture),
  }
}

function joinKafkaRef(clusterRef: string, topicName: string): string {
  return `${clusterRef.replace(/\/$/, '')}/${topicName}`
}

function computeKafkaFixtureVersionHash(input: DpmKafkaTopicProfileFixture): string {
  return `sha256:${createHash('sha256').update(stableStringify(input)).digest('hex')}`
}

function stableStringify(value: unknown): string {
  return JSON.stringify(sortValue(value))
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue)
  if (!value || typeof value !== 'object') return value

  const record = value as Record<string, unknown>
  const sorted: Record<string, unknown> = {}
  for (const key of Object.keys(record).sort()) {
    const next = record[key]
    if (next !== undefined) sorted[key] = sortValue(next)
  }
  return sorted
}
