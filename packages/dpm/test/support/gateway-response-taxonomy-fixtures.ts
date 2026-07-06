import type {
  GatewayWorkflowResponseSchemaName,
} from './gateway-workflow-response-schema-fixtures.js'

type GatewayInvalidResponseTaxonomyCase =
  readonly [GatewayWorkflowResponseSchemaName, Record<string, unknown>, string]

export const gatewayInvalidResponseTaxonomyCases = [
  ['DpmRelationshipDiscoveryReport', {
    reportRef: 'report://discovery',
    candidates: [{ name: 'rel_orders_customer', recommendation: 'auto_approve' }],
  }, 'unknown recommendation'],
  ['DpmRegistrySnapshotResponse', {
    datasetId: 'commerce_ai',
    registryVersion: 'reg-2026-07-01',
    relationships: [{ name: 'rel_orders_customer', status: 'unknown_status' }],
  }, 'unknown relationship status'],
] as const satisfies readonly GatewayInvalidResponseTaxonomyCase[]
