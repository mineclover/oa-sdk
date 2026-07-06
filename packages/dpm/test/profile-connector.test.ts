import { describe, expect, it } from 'vitest'

import {
  createPostgresCatalogSnapshot,
  normalizeDpmProfileArtifact,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'
import { readCatalogFixture } from './support/catalog-fixtures.js'
import { expectValidConnectorResult } from './support/profile-connector-assertions.js'
import { createKafkaProfileArtifactInput } from './support/profile-connector-kafka-artifact-inputs.js'
import { createPostgresProfileArtifactInput } from './support/profile-connector-postgres-artifact-inputs.js'
import {
  createKafkaProfileConnectorResult,
  createPostgresProfileConnectorResult,
} from './support/profile-connector-result-fixtures.js'

describe('DPM profile connector output contract', () => {
  it('describes PostgreSQL catalog profiling as a connector output without changing catalog snapshots', () => {
    const catalogFixture = readCatalogFixture<PostgresCatalogSnapshotInput>(
      'postgres-commerce.json',
    )
    const catalogSnapshot = createPostgresCatalogSnapshot(catalogFixture)
    const profileArtifact = normalizeDpmProfileArtifact(createPostgresProfileArtifactInput())
    const result = createPostgresProfileConnectorResult(profileArtifact)

    expect(catalogSnapshot.kind).toBe('dpm.catalog.snapshot.v1')
    expect(catalogSnapshot.source.kind).toBe('postgresql')
    expect('profileArtifact' in catalogSnapshot).toBe(false)
    expect(result.freshness.profileVersionHash).toBe(profileArtifact.freshness.versionHash)
    expectValidConnectorResult(result)
  })

  it('uses the same connector result shape for Kafka fixture evidence', () => {
    const profileArtifact = normalizeDpmProfileArtifact(createKafkaProfileArtifactInput())
    const result = createKafkaProfileConnectorResult({
      profileArtifact,
    })

    expect(result.profileArtifact?.sources[0]?.kind).toBe('kafka_topic_bundle')
    expect(result.profileArtifact?.nodes.map(node => node.kind)).toContain('message_field')
    expectValidConnectorResult(result)
  })
})
