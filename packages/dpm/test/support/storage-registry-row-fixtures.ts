import type { DpmRegistryRelationshipRow } from '../../src/index.js'

export const STORAGE_REGISTRY_DATASET_ID = 'commerce_ai' as const
export const STORAGE_REGISTRY_VERSION = 'reg-2026-07-01' as const
export const STORAGE_REGISTRY_EXPORTED_AT = '2026-07-01T00:00:00.000Z' as const

export const storageRegistryRows: DpmRegistryRelationshipRow[] = [
  {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationshipName: 'rel_orders_customer',
    relationshipVersion: '1',
    status: 'approved',
    relationshipType: 'many_to_one',
    parentTable: 'public.customers',
    parentColumns: ['customer_no'],
    childTable: 'public.orders',
    childColumns: ['customer_no'],
    namespace: 'customer',
    transformStrategy: 'relationship_token',
    orphanPolicy: 'block',
    contextColumns: ['tenant_id'],
    confidenceScore: 0.99,
    evidence: [
      {
        kind: 'catalog_fk',
        message: 'orders.customer_no references customers.customer_no',
        score: 0.99,
      },
    ],
    approval: {
      owner: 'privacy-team',
      approvedBy: 'dpo@example.com',
      approvedAt: '2026-07-01T00:00:00.000Z',
    },
    sourceFreshnessHash: 'sha256:storage-catalog-v1',
  },
  {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationshipName: 'rel_orders_status',
    relationshipVersion: '1',
    status: 'rejected',
    relationshipType: 'code_lookup',
    parentTable: 'public.order_statuses',
    parentColumns: ['status_code'],
    childTable: 'public.orders',
    childColumns: ['status'],
    namespace: 'order_status',
    transformStrategy: 'keep_code',
    orphanPolicy: 'warn',
    contextColumns: [],
    evidence: [],
    approval: {
      owner: 'privacy-team',
      reviewedBy: 'dpo@example.com',
      reviewedAt: '2026-07-01T00:00:00.000Z',
      reason: 'Ambiguous operational status candidate.',
    },
    sourceFreshnessHash: 'sha256:storage-catalog-v1',
  },
]
