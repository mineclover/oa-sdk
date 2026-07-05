import type { DpmProfileArtifactInput } from './artifact.js'
import type { DpmKafkaTopicProfileFixture } from './kafka-fixture-types.js'
import { createKafkaTopicProfileGraph } from './kafka-topic-profile-graph.js'
import { createKafkaTopicSourceDescriptor } from './kafka-topic-source.js'

export type KafkaTopicProfileArtifactInputOptions = {
  input: DpmKafkaTopicProfileFixture
  connectorId: string
  connectorVersion: string
}

export function createKafkaTopicProfileArtifactInput(
  options: KafkaTopicProfileArtifactInputOptions,
): DpmProfileArtifactInput {
  const { input, connectorId, connectorVersion } = options
  const source = createKafkaTopicSourceDescriptor({
    fixture: input,
    connectorId,
    connectorVersion,
  })
  const sourceId = source.id
  const graph = createKafkaTopicProfileGraph({
    topic: input.topic,
    sourceId,
    connectorId,
  })

  return {
    profileId: input.profileId,
    datasetId: input.datasetId,
    profileVersion: input.profileVersion,
    createdAt: input.createdAt,
    sources: [source],
    evidenceSources: graph.evidenceSources,
    nodes: graph.nodes,
    edges: graph.edges,
    metrics: graph.metrics,
    diagnostics: [],
  }
}
