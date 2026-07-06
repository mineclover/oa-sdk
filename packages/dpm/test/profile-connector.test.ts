import { describe, expect, it } from 'vitest'

import {
  createPostgresCatalogSnapshot,
  normalizeDpmProfileArtifact,
  normalizeDpmProfileConnectorResult,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'
import { readCatalogFixture } from './support/catalog-fixtures.js'
import { expectValidConnectorResult } from './support/profile-connector-assertions.js'
import {
  createKafkaProfileArtifactInput,
  createPostgresProfileArtifactInput,
} from './support/profile-connector-artifact-inputs.js'
import { allEvidenceCapabilities } from './support/profile-connector-capabilities.js'

describe('DPM profile connector output contract', () => {
  it('describes PostgreSQL catalog profiling as a connector output without changing catalog snapshots', () => {
    const catalogFixture = readCatalogFixture<PostgresCatalogSnapshotInput>('postgres-commerce.json')
    const catalogSnapshot = createPostgresCatalogSnapshot(catalogFixture)
    const profileArtifact = normalizeDpmProfileArtifact(createPostgresProfileArtifactInput())
    const result = normalizeDpmProfileConnectorResult({
      connectorId: 'dpm.postgres.catalog',
      connectorVersion: '0.1.0',
      sourceKind: 'postgresql_catalog',
      captureMode: 'read_only',
      status: 'completed',
      capabilities: allEvidenceCapabilities('dpm.postgres.catalog', '0.1.0', 'postgresql_catalog', 'read_only'),
      observedEvidenceKinds: ['source', 'evidence_source', 'node', 'edge', 'metric'],
      diagnostics: [],
      profileArtifact,
    })

    expect(catalogSnapshot.kind).toBe('dpm.catalog.snapshot.v1')
    expect(catalogSnapshot.source.kind).toBe('postgresql')
    expect('profileArtifact' in catalogSnapshot).toBe(false)
    expect(result.freshness.profileVersionHash).toBe(profileArtifact.freshness.versionHash)
    expectValidConnectorResult(result)
  })

  it('uses the same connector result shape for Kafka fixture evidence', () => {
    const profileArtifact = normalizeDpmProfileArtifact(createKafkaProfileArtifactInput())
    const result = normalizeDpmProfileConnectorResult({
      connectorId: 'dpm.kafka.fixture',
      connectorVersion: '0.1.0',
      sourceKind: 'kafka_topic_bundle',
      captureMode: 'fixture',
      status: 'completed',
      capabilities: allEvidenceCapabilities('dpm.kafka.fixture', '0.1.0', 'kafka_topic_bundle', 'fixture'),
      observedEvidenceKinds: ['source', 'evidence_source', 'node', 'edge', 'metric'],
      diagnostics: [],
      profileArtifact,
    })

    expect(result.profileArtifact?.sources[0]?.kind).toBe('kafka_topic_bundle')
    expect(result.profileArtifact?.nodes.map(node => node.kind)).toContain('message_field')
    expectValidConnectorResult(result)
  })
})
