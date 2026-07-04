import Ajv2020 from 'ajv/dist/2020.js'
import { describe, expect, it } from 'vitest'

import {
  DPM_PROFILE_ARTIFACT_KIND,
  DPM_PROFILE_ARTIFACT_SCHEMA,
  DPM_PROFILE_EDGE_KINDS,
  DPM_PROFILE_METRIC_KINDS,
  DPM_PROFILE_NODE_KINDS,
  DPM_PROFILE_SOURCE_KINDS,
  normalizeDpmProfileArtifact,
  validateDpmProfileArtifactSchema,
  type DpmProfileArtifact,
  type DpmProfileArtifactInput,
} from '../src/index.js'

function compileProfileSchema() {
  const ajv = new Ajv2020({ allErrors: true, strict: false })
  return ajv.compile(DPM_PROFILE_ARTIFACT_SCHEMA)
}

function createDbProfileInput(): DpmProfileArtifactInput {
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
      'evidence:postgres:orders.customer_no': {
        coordinate: {
          kind: 'postgresql_catalog',
          sourceId: 'source:postgres:commerce',
          path: 'public.orders.customer_no',
          pointer: '#/columns/public.orders.customer_no',
        },
        connectorId: 'dpm.postgres.catalog',
        capturedAt: '2026-07-04T00:00:00.000Z',
      },
    },
    nodes: [
      {
        id: 'node:dataset:commerce',
        kind: 'dataset',
        label: 'commerce_ai',
        coordinate: {
          kind: 'manual_import',
          path: 'commerce_ai',
        },
      },
      {
        id: 'node:table:orders',
        kind: 'table',
        label: 'public.orders',
        coordinate: {
          kind: 'postgresql_catalog',
          sourceId: 'source:postgres:commerce',
          path: 'public.orders',
        },
      },
      {
        id: 'node:column:orders.customer_no',
        kind: 'column',
        label: 'orders.customer_no',
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
        id: 'edge:orders.contains.customer_no',
        kind: 'contains',
        fromNodeId: 'node:table:orders',
        toNodeId: 'node:column:orders.customer_no',
        evidenceIds: ['evidence:postgres:orders.customer_no'],
      },
    ],
    metrics: [
      {
        id: 'metric:orders.customer_no.presence',
        kind: 'presence_ratio',
        subjectId: 'node:column:orders.customer_no',
        value: 1,
        unit: 'ratio',
        evidenceIds: ['evidence:postgres:orders.customer_no'],
      },
    ],
    diagnostics: [],
  }
}

function createKafkaProfileInput(): DpmProfileArtifactInput {
  return {
    profileId: 'profile:commerce-events',
    datasetId: 'commerce_ai',
    profileVersion: '2026-07-04.kafka',
    createdAt: '2026-07-04T00:00:00.000Z',
    sources: [
      {
        id: 'source:kafka:orders',
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
          sourceId: 'source:kafka:orders',
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
          sourceId: 'source:kafka:orders',
          path: 'orders.created',
        },
      },
      {
        id: 'node:key:orders.created',
        kind: 'message_key',
        label: 'orders.created key',
        coordinate: {
          kind: 'kafka_topic_bundle',
          sourceId: 'source:kafka:orders',
          path: 'orders.created.key',
          pointer: '/key',
        },
        dataType: 'string',
      },
      {
        id: 'node:field:orders.created.customer_no',
        kind: 'message_field',
        label: 'value.customer.customer_no',
        coordinate: {
          kind: 'kafka_topic_bundle',
          sourceId: 'source:kafka:orders',
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
        id: 'metric:orders.created.key_coverage',
        kind: 'key_coverage_ratio',
        subjectId: 'node:key:orders.created',
        value: 0.998,
        unit: 'ratio',
        evidenceIds: ['evidence:kafka:orders.created.customer_no'],
      },
    ],
    diagnostics: [
      {
        severity: 'info',
        code: 'CONN001',
        message: 'Kafka topic profile was loaded from fixture evidence.',
        connectorId: 'dpm.kafka.fixture',
        evidenceIds: ['evidence:kafka:orders.created.customer_no'],
      },
    ],
  }
}

describe('DPM profile artifact contract', () => {
  it('normalizes DB and Kafka evidence into the same profile artifact contract', () => {
    const validate = compileProfileSchema()
    const dbProfile = normalizeDpmProfileArtifact(createDbProfileInput())
    const kafkaProfile = normalizeDpmProfileArtifact(createKafkaProfileInput())

    for (const profile of [dbProfile, kafkaProfile]) {
      expect(profile.kind).toBe(DPM_PROFILE_ARTIFACT_KIND)
      expect(profile.freshness.versionHash).toMatch(/^sha256:[a-f0-9]{64}$/)
      expect(validate(profile), JSON.stringify(validate.errors, null, 2)).toBe(true)
      expect(validateDpmProfileArtifactSchema(profile).valid).toBe(true)
    }
  })

  it('projects runtime profile taxonomies into the JSON Schema contract', () => {
    const schema = DPM_PROFILE_ARTIFACT_SCHEMA as any

    expect(schema.properties.sources.items.properties.kind.enum).toEqual([...DPM_PROFILE_SOURCE_KINDS])
    expect(schema.properties.nodes.items.properties.kind.enum).toEqual([...DPM_PROFILE_NODE_KINDS])
    expect(schema.properties.edges.items.properties.kind.enum).toEqual([...DPM_PROFILE_EDGE_KINDS])
    expect(schema.properties.metrics.items.properties.kind.enum).toEqual([...DPM_PROFILE_METRIC_KINDS])
  })

  it('rejects unknown taxonomy values, missing provenance, and raw sample payload fields', () => {
    const validate = compileProfileSchema()
    const profile = normalizeDpmProfileArtifact(createKafkaProfileInput())

    expect(validate({
      ...profile,
      sources: [{ ...profile.sources[0], kind: 'unknown_source' }],
    }), 'profile unexpectedly accepted an unknown source kind').toBe(false)
    expect(validate({
      ...profile,
      nodes: [{ id: 'node:field:missing-provenance', kind: 'message_field', label: 'missing' }],
    }), 'profile unexpectedly accepted a node without a coordinate').toBe(false)
    expect(validate({
      ...profile,
      rawSample: { customer_no: 'C-001' },
    }), 'profile unexpectedly accepted a raw sample payload').toBe(false)
  })

  it('changes freshness when normalized profile evidence changes', () => {
    const original = normalizeDpmProfileArtifact(createKafkaProfileInput())
    const changed = normalizeDpmProfileArtifact({
      ...createKafkaProfileInput(),
      metrics: [
        {
          id: 'metric:orders.created.key_coverage',
          kind: 'key_coverage_ratio',
          subjectId: 'node:key:orders.created',
          value: 0.95,
          unit: 'ratio',
          evidenceIds: ['evidence:kafka:orders.created.customer_no'],
        },
      ],
    })

    expect(changed.freshness.versionHash).not.toBe(original.freshness.versionHash)
  })

  it('normalizes equivalent profile artifacts to the same freshness hash', () => {
    const first = normalizeDpmProfileArtifact(createDbProfileInput())
    const input = createDbProfileInput()
    const second = normalizeDpmProfileArtifact({
      ...input,
      nodes: [...input.nodes].reverse(),
      edges: [...input.edges].reverse(),
      metrics: [...input.metrics].reverse(),
      diagnostics: [...input.diagnostics].reverse(),
      evidenceSources: Object.fromEntries(Object.entries(input.evidenceSources).reverse()),
    })

    expect(second.freshness.versionHash).toBe(first.freshness.versionHash)
    expect(second.nodes.map(node => node.id)).toEqual(first.nodes.map(node => node.id))
  })

  it('returns normalized schema issues for invalid profile artifacts', () => {
    const profile = normalizeDpmProfileArtifact(createKafkaProfileInput()) as DpmProfileArtifact
    const result = validateDpmProfileArtifactSchema({
      ...profile,
      metrics: [{ id: '', kind: 'presence_ratio', subjectId: 'node:key:orders.created', value: 1 }],
    })

    expect(result.valid).toBe(false)
    expect(result.issues.some(issue => issue.instancePath.includes('/metrics/0/id'))).toBe(true)
  })
})
