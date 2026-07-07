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
  }],
  ['DpmRegistrySnapshotResponse', {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationships: [{ name: 'rel_orders_customer', status: 'approved' }],
  }],
] as const satisfies readonly GatewayMinimalResponseCase[]
