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
