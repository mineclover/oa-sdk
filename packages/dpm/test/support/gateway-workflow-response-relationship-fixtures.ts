import type {
  GatewayMinimalResponseCase,
} from './gateway-workflow-response-case-types.js'

export const gatewayRelationshipMinimalResponseCases = [
  ['DpmRelationshipDiscoveryReport', {
    reportRef: 'report://discovery',
    candidates: [{ name: 'rel_orders_customer', recommendation: 'review' }],
  }],
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

