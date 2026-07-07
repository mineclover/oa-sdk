import type {
  GatewayMinimalResponseCase,
} from './gateway-workflow-response-case-types.js'
import {
  readCommerceDiscoveryReport,
} from './discovery-fixtures.js'

export const gatewayRelationshipMinimalResponseCases = [
  ['DpmRelationshipDiscoveryReport', readCommerceDiscoveryReport()],
  ['DpmCandidateImportResponse', { imported: 1, rejected: 0 }],
  ['DpmRelationshipApprovalResponse', {
    relationshipName: 'rel_orders_customer',
    status: 'approved',
    relationship: {
      name: 'rel_orders_customer',
      version: '1',
      status: 'approved',
      type: 'one_to_many',
      parent: {
        table: 'public.customers',
        columns: ['customer_no'],
      },
      child: {
        table: 'public.orders',
        columns: ['customer_no'],
      },
      namespace: 'customer',
      transformStrategy: 'entity_token',
      orphanPolicy: 'block',
      confidenceScore: 0.998,
      evidence: readCommerceDiscoveryReport().candidates[0]!.evidence,
      approval: {
        owner: 'privacy-platform',
        approvedBy: 'privacy-reviewer',
        reason: 'reviewed',
      },
    },
  }],
  ['DpmRegistrySnapshotResponse', {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationships: [{ name: 'rel_orders_customer', status: 'approved' }],
  }],
] as const satisfies readonly GatewayMinimalResponseCase[]
