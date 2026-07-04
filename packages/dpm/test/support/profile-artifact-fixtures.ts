import type { DpmProfileArtifactInput } from '../../src/index.js'

export function createDbProfileInput(): DpmProfileArtifactInput {
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

export function createKafkaProfileInput(): DpmProfileArtifactInput {
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
