import { readFileSync } from 'node:fs'
import { join } from 'node:path'

import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS,
  DPM_PROFILE_CONNECTOR_RESULT_KIND,
  createPostgresCatalogSnapshot,
  normalizeDpmProfileArtifact,
  normalizeDpmProfileConnectorResult,
  validateDpmProfileConnectorResult,
  type DpmProfileArtifactInput,
  type DpmProfileConnectorCapabilities,
  type DpmProfileConnectorResult,
  type PostgresCatalogSnapshotInput,
} from '../src/index.js'

const catalogFixturesRoot = new URL('./fixtures/catalog/', import.meta.url)

function readCatalogFixture<T>(name: string): T {
  const fixturePath = join(catalogFixturesRoot.pathname, name)
  return JSON.parse(readFileSync(fixturePath, 'utf8')) as T
}

function allEvidenceCapabilities(
  connectorId: string,
  connectorVersion: string,
  sourceKind: DpmProfileConnectorCapabilities['sourceKinds'][number],
  captureMode: DpmProfileConnectorCapabilities['captureModes'][number],
): DpmProfileConnectorCapabilities {
  return {
    connectorId,
    connectorVersion,
    sourceKinds: [sourceKind],
    captureModes: [captureMode],
    supportedEvidenceKinds: [...DPM_PROFILE_CONNECTOR_EVIDENCE_KINDS],
    skippedEvidenceKinds: [],
  }
}

function createPostgresProfileArtifactInput(): DpmProfileArtifactInput {
  return {
    profileId: 'profile:commerce-db',
    datasetId: 'commerce_ai',
    profileVersion: '2026-07-04.db',
    createdAt: '2026-07-04T00:00:00.000Z',
    sources: [
      {
        id: 'source:postgres:commerce',
        kind: 'postgresql_catalog',
        connectorId: 'dpm.postgres.catalog',
        connectorVersion: '0.1.0',
        refs: ['postgres://commerce/public'],
        captureMode: 'read_only',
        sourceVersionHash: 'sha256:postgres-catalog-v1',
      },
    ],
    evidenceSources: {
      'evidence:postgres:public.orders.customer_no': {
        coordinate: {
          kind: 'postgresql_catalog',
          sourceId: 'source:postgres:commerce',
          path: 'public.orders.customer_no',
          pointer: '#/columns/public.orders.customer_no',
        },
        connectorId: 'dpm.postgres.catalog',
      },
    },
    nodes: [
      {
        id: 'node:table:public.orders',
        kind: 'table',
        label: 'public.orders',
        coordinate: {
          kind: 'postgresql_catalog',
          sourceId: 'source:postgres:commerce',
          path: 'public.orders',
        },
      },
      {
        id: 'node:column:public.orders.customer_no',
        kind: 'column',
        label: 'public.orders.customer_no',
        coordinate: {
          kind: 'postgresql_catalog',
          sourceId: 'source:postgres:commerce',
          path: 'public.orders.customer_no',
          pointer: '#/columns/public.orders.customer_no',
        },
        dataType: 'text',
      },
    ],
    edges: [
      {
        id: 'edge:public.orders.contains.customer_no',
        kind: 'contains',
        fromNodeId: 'node:table:public.orders',
        toNodeId: 'node:column:public.orders.customer_no',
        evidenceIds: ['evidence:postgres:public.orders.customer_no'],
      },
    ],
    metrics: [
      {
        id: 'metric:public.orders.customer_no.presence',
        kind: 'presence_ratio',
        subjectId: 'node:column:public.orders.customer_no',
        value: 1,
        unit: 'ratio',
        evidenceIds: ['evidence:postgres:public.orders.customer_no'],
      },
    ],
    diagnostics: [],
  }
}

function createKafkaProfileArtifactInput(): DpmProfileArtifactInput {
  return {
    profileId: 'profile:commerce-events',
    datasetId: 'commerce_ai',
    profileVersion: '2026-07-04.kafka',
    createdAt: '2026-07-04T00:00:00.000Z',
    sources: [
      {
        id: 'source:kafka:orders.created',
        kind: 'kafka_topic_bundle',
        connectorId: 'dpm.kafka.fixture',
        connectorVersion: '0.1.0',
        refs: ['kafka://commerce/orders.created'],
        captureMode: 'fixture',
        sourceVersionHash: 'sha256:kafka-topic-v1',
      },
    ],
    evidenceSources: {
      'evidence:kafka:orders.created.customer_no': {
        coordinate: {
          kind: 'kafka_topic_bundle',
          sourceId: 'source:kafka:orders.created',
          path: 'orders.created.value.customer.customer_no',
          pointer: '/value/customer/customer_no',
        },
        connectorId: 'dpm.kafka.fixture',
      },
    },
    nodes: [
      {
        id: 'node:topic:orders.created',
        kind: 'topic',
        label: 'orders.created',
        coordinate: {
          kind: 'kafka_topic_bundle',
          sourceId: 'source:kafka:orders.created',
          path: 'orders.created',
        },
      },
      {
        id: 'node:field:orders.created.customer_no',
        kind: 'message_field',
        label: 'value.customer.customer_no',
        coordinate: {
          kind: 'kafka_topic_bundle',
          sourceId: 'source:kafka:orders.created',
          path: 'orders.created.value.customer.customer_no',
          pointer: '/value/customer/customer_no',
        },
        dataType: 'string',
      },
    ],
    edges: [
      {
        id: 'edge:orders.created.contains.customer_no',
        kind: 'contains',
        fromNodeId: 'node:topic:orders.created',
        toNodeId: 'node:field:orders.created.customer_no',
        evidenceIds: ['evidence:kafka:orders.created.customer_no'],
      },
    ],
    metrics: [
      {
        id: 'metric:orders.created.customer_no.presence',
        kind: 'presence_ratio',
        subjectId: 'node:field:orders.created.customer_no',
        value: 0.997,
        unit: 'ratio',
        evidenceIds: ['evidence:kafka:orders.created.customer_no'],
      },
    ],
    diagnostics: [],
  }
}

function expectValidConnectorResult(result: DpmProfileConnectorResult): void {
  const validation = validateDpmProfileConnectorResult(result)

  expect(result.kind).toBe(DPM_PROFILE_CONNECTOR_RESULT_KIND)
  expect(result.freshness.runHash).toMatch(/^sha256:[a-f0-9]{64}$/)
  expect(validation.diagnostics, JSON.stringify(validation.diagnostics, null, 2)).toEqual([])
  expect(validation.valid).toBe(true)
}

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

  it('keeps connector failures as diagnostic payloads', () => {
    const result = normalizeDpmProfileConnectorResult({
      connectorId: 'dpm.kafka.fixture',
      connectorVersion: '0.1.0',
      sourceKind: 'kafka_topic_bundle',
      captureMode: 'fixture',
      status: 'failed',
      capabilities: allEvidenceCapabilities('dpm.kafka.fixture', '0.1.0', 'kafka_topic_bundle', 'fixture'),
      observedEvidenceKinds: ['diagnostic'],
      diagnostics: [
        {
          severity: 'error',
          code: 'CONN500',
          message: 'Kafka topic fixture could not be loaded.',
          connectorId: 'dpm.kafka.fixture',
          coordinate: {
            kind: 'kafka_topic_bundle',
            path: 'orders.created',
          },
        },
      ],
    })
    const missingDiagnostic = normalizeDpmProfileConnectorResult({
      ...result,
      status: 'failed',
      diagnostics: [],
    })

    expect(result.profileArtifact).toBeUndefined()
    expect(validateDpmProfileConnectorResult(result).valid).toBe(true)
    expect(validateDpmProfileConnectorResult(missingDiagnostic).diagnostics.map(diagnostic => diagnostic.code)).toContain('CONN105')
  })

  it('rejects observed evidence kinds outside connector capabilities', () => {
    const profileArtifact = normalizeDpmProfileArtifact(createKafkaProfileArtifactInput())
    const result = normalizeDpmProfileConnectorResult({
      connectorId: 'dpm.kafka.fixture',
      connectorVersion: '0.1.0',
      sourceKind: 'kafka_topic_bundle',
      captureMode: 'fixture',
      status: 'completed',
      capabilities: {
        connectorId: 'dpm.kafka.fixture',
        connectorVersion: '0.1.0',
        sourceKinds: ['kafka_topic_bundle'],
        captureModes: ['fixture'],
        supportedEvidenceKinds: ['source', 'node'],
        skippedEvidenceKinds: ['metric'],
      },
      observedEvidenceKinds: ['source', 'node', 'metric'],
      diagnostics: [],
      profileArtifact,
    })
    const validation = validateDpmProfileConnectorResult(result)

    expect(validation.valid).toBe(false)
    expect(validation.diagnostics.map(diagnostic => diagnostic.code)).toContain('CONN104')
  })
})
