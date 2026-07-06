import type { DpmProfileArtifactInput } from '../../src/index.js'

export function createPostgresProfileArtifactInput(): DpmProfileArtifactInput {
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

export function createKafkaProfileArtifactInput(): DpmProfileArtifactInput {
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
